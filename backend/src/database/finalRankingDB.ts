import { MongoClient } from 'mongodb';
import { logger } from '@/logger';

/*
 * 结榜图数据存储(MongoDB, 集合 finalRankings, 与 users_1/players 等同库):
 * 文档结构: { _id: eventId, groups: { ['platform:groupId']: { groupName?, players: { [uid]: FinalRankingPlayer } } } }
 * 层级为 活动ID → 群号 → 玩家, 每期活动一个文档。
 * 后端为 PM2 fork 单实例, 读-改-写无并发冲突(同 playerDB/userDB 模式)。
 */

//结榜时刻玩家快照 + 成绩(PT榜与歌榜字段共存, 两类提交各自只更新自己的一半)
export interface FinalRankingPlayer {
    name: string;
    rank: number;
    introduction: string;
    avatarSid: number;
    avatarStrained: number;
    degrees: number[];
    ptRanking?: number;
    pt?: number;
    songRanking?: number;
    songScore?: number;
    songIndex?: number;
    recordedBy?: string;
    updatedAt: number;
}

//携带 uid 的完整记录(渲染用)
export type FinalRankingPlayerWithUid = FinalRankingPlayer & { uid: number };

interface FinalRankingGroup {
    groupName?: string;
    players: { [uid: string]: FinalRankingPlayer };
}

interface FinalRankingEventDocument {
    _id: number;
    eventId: number;
    groups: { [platformGroupId: string]: FinalRankingGroup };
}

//群组键: 'platform:groupId'
//注意: 该键会被拼入 Mongo 点路径查询(groups.<key>), platform/groupId 不得包含 '.' 或以 '$' 开头;
//QQ(onebot)群号等主流平台均为纯数字, 满足约束
function groupKey(platform: string, groupId: string): string {
    return `${platform}:${groupId}`;
}

export class FinalRankingDB {
    private client: MongoClient;
    private db: any;

    constructor(uri: string, dbName: string) {
        this.client = new MongoClient(uri);
        this.db = this.client.db(dbName);
        //尝试连接数据库，如果连接失败则记录错误(懒连接, 操作时仍会重试)
        this.connect().catch((err) => {
            logger('finalRankingDB', `连接数据库失败 Error: ${err.message}`);
        });
    }

    private getCollection() {
        return this.db.collection('finalRankings');
    }

    async connect(): Promise<void> {
        await this.client.connect();
    }

    /*
     * 写入/更新一名玩家(读-改-写):
     * update 中显式提供的键覆盖旧值, 未提供的键保留旧值
     * (例如 PT榜提交不会清掉同 uid 已有的歌榜字段), 快照字段每次刷新。
     */
    async updatePlayer(eventId: number, platform: string, groupId: string, uid: number, update: FinalRankingPlayer, groupName?: string): Promise<void> {
        const key = groupKey(platform, groupId);
        const existing = await this.getCollection().findOne({ _id: eventId });
        const document = existing as FinalRankingEventDocument | null ?? { _id: eventId, eventId, groups: {} };
        const group = document.groups[key] ?? { players: {} };
        if (groupName != undefined && groupName != '') {
            group.groupName = groupName;
        }
        group.players[String(uid)] = { ...group.players[String(uid)], ...update, updatedAt: update.updatedAt };
        document.groups[key] = group;
        //$set 载荷不得包含 _id(不可变字段)
        const { _id, ...data } = document;
        await this.getCollection().updateOne({ _id: eventId }, { $set: data }, { upsert: true });
    }

    //读取一个群在某期的全部玩家记录, 无数据返回 null
    async getGroupPlayers(eventId: number, platform: string, groupId: string): Promise<{ groupName?: string, players: FinalRankingPlayerWithUid[] } | null> {
        const document = await this.getCollection().findOne({ _id: eventId }) as FinalRankingEventDocument | null;
        if (document == null) {
            return null;
        }
        const group = document.groups[groupKey(platform, groupId)];
        if (group == null) {
            return null;
        }
        const players = Object.entries(group.players).map(([uid, player]) => ({ ...player, uid: Number(uid) }));
        if (players.length == 0) {
            return null;
        }
        return { groupName: group.groupName, players };
    }

    //本群最新有记录的活动ID(用于无参查结榜图与删除指令的目标期)
    async getLatestRecordedEventId(platform: string, groupId: string): Promise<number | null> {
        const key = groupKey(platform, groupId);
        //删除时会清理空群组条目, groups.<key> 存在即必有数据
        const document = await this.getCollection().findOne(
            { [`groups.${key}`]: { $exists: true } },
            { projection: { _id: 1 }, sort: { _id: -1 } }
        );
        if (document == null) {
            return null;
        }
        return document._id as number;
    }

    //删除一个群某期中的一名玩家; 组内再无玩家时连带删除群组条目。返回是否实际删除
    async deletePlayer(eventId: number, platform: string, groupId: string, uid: number): Promise<boolean> {
        const key = groupKey(platform, groupId);
        const existing = await this.getCollection().findOne({ _id: eventId });
        const document = existing as FinalRankingEventDocument | null;
        if (document == null) {
            return false;
        }
        const group = document.groups[key];
        if (group == null || group.players[String(uid)] == undefined) {
            return false;
        }
        delete group.players[String(uid)];
        if (Object.keys(group.players).length == 0) {
            delete document.groups[key];
        }
        else {
            document.groups[key] = group;
        }
        const { _id, ...data } = document;
        await this.getCollection().updateOne({ _id: eventId }, { $set: data });
        return true;
    }
}
