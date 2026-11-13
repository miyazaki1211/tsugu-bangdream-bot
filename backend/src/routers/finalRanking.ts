import express, { Request, Response } from 'express';
import { body } from 'express-validator';
import { middleware } from '@/routers/middleware';
import { listToBase64 } from '@/routers/utils';
import { FinalRankingDB, FinalRankingPlayer } from '@/database/finalRankingDB';
import { drawFinalRanking } from '@/view/finalRanking';
import { Event, getLatestEndedEvent, getPresentEvent } from '@/types/Event';
import { Player } from '@/types/Player';
import { Server } from '@/types/Server';
import { Song } from '@/types/Song';
import { serverNameFullList } from '@/config';

/*
 * 结榜图: 记录/查询/删除群内玩家的活动结榜成绩(国服)
 * 数据存储于 MongoDB(集合 finalRankings, 固定在 tsugu-bangdream-bot 库)
 * 无条件挂载, 不依赖 LOCAL_DB 开关(同 microOptimize 对 PlayerDB 的用法)
 */

const router = express.Router();
const finalRankingDB = new FinalRankingDB(
    process.env.MONGODB_URI ?? 'mongodb://localhost:27017/',
    process.env.MONGODB_DATABASE_NAME || 'tsugu-bangdream-bot'
);

//提交时限: 活动结束时刻 ~ 结束日期+3天的24:00(北京时间 UTC+8 无夏令时)
function finalRecordDeadline(endAt: number): number {
    const cn = new Date(endAt + 8 * 3600000)
    return Date.UTC(cn.getUTCFullYear(), cn.getUTCMonth(), cn.getUTCDate() + 4) - 8 * 3600000
}

//时限文案: "MM月DD日24:00"
function formatDeadline(deadline: number): string {
    const cn = new Date(deadline - 1 + 8 * 3600000)
    return `${cn.getUTCMonth() + 1}月${cn.getUTCDate()}日24:00`
}

//解析可记录的活动: 最近一个已结束的活动, 且当前时间须在其记录时限内
function resolveSubmittableEvent(now: number): { event: Event } | { error: string } {
    const latestEnded = getLatestEndedEvent(Server.cn, now)
    if (latestEnded == null || latestEnded.eventId == undefined || latestEnded.endAt[Server.cn] == null) {
        return { error: '错误: 未找到已结束的国服活动' }
    }
    const endAt = latestEnded.endAt[Server.cn]
    if (now > finalRecordDeadline(endAt)) {
        const present = getPresentEvent(Server.cn, now)
        //有进行中的活动时补充提示, 避免用户误以为是新一期可以记录
        if (present != null && present.startAt[Server.cn] != null && present.endAt[Server.cn] != null
            && present.startAt[Server.cn] <= now && present.endAt[Server.cn] >= now) {
            return { error: `错误: 活动${latestEnded.eventId}的结榜记录期限已过 (截止 ${formatDeadline(finalRecordDeadline(endAt))}); 当前活动${present.eventId}尚未结束, 请在活动结束后再记录` }
        }
        return { error: `错误: 活动${latestEnded.eventId}的结榜记录期限已过 (截止 ${formatDeadline(finalRecordDeadline(endAt))})` }
    }
    return { event: latestEnded }
}

//生成活动歌榜曲目清单文案(序号越界时提示用户可选歌曲)
function eventMusicListText(event: Event): string {
    const musics = event.musics?.[Server.cn] ?? []
    return musics
        .map((m, i) => {
            const song = new Song(m.musicId)
            if (!song.isExist) {
                return `第${i + 1}首: ID ${m.musicId}`
            }
            const title = song.musicTitle?.[Server.cn] ?? song.musicTitle?.[Server.jp] ?? `ID ${m.musicId}`
            return `第${i + 1}首: ${title}`
        })
        .join('\n')
}

//结榜图 / 歌榜结榜图: 记录结榜成绩
router.post('/submit',
    [
        body('platform').isString(),
        body('groupId').isString(),
        body('type').isIn(['event', 'music']),
        body('uid').isInt({ min: 1 }),
        body('ranking').isInt({ min: 1 }),
        body('pt').optional().isInt({ min: 0 }),
        body('score').optional().isInt({ min: 0 }),
        body('songIndex').optional().isInt({ min: 1 }),
        body('signature').optional().isString(),
        body('groupName').optional().isString(),
        body('recordedBy').optional().isString(),
    ],
    middleware,
    async (req: Request, res: Response) => {
        const { platform, groupId, groupName, type, uid, ranking, pt, score, songIndex, signature, recordedBy } = req.body;
        try {
            //参数完整性
            if (type == 'event' && pt == undefined) {
                return res.send(listToBase64(['错误: 缺少PT参数, 用法: 结榜图 玩家ID 排名 PT [自定义签名]']));
            }
            if (type == 'music' && score == undefined) {
                return res.send(listToBase64(['错误: 缺少分数参数, 用法: 歌榜结榜图 玩家ID 排名 分数 [第几首歌] [自定义签名]']));
            }
            //时限与活动解析
            const now = Date.now()
            const resolved = resolveSubmittableEvent(now)
            if ('error' in resolved) {
                return res.send(listToBase64([resolved.error]));
            }
            const event = resolved.event
            //歌榜类型校验
            let resolvedSongIndex: number | undefined
            if (type == 'music') {
                await event.initFull()
                const eventType = event.eventType
                if (eventType == 'mission_live' || eventType == 'live_try') {
                    return res.send(listToBase64([`错误: 活动${event.eventId}为${serverNameFullList[Server.cn]}${eventType == 'mission_live' ? '任务协力' : 'EX协力'}活动, 没有歌榜`]));
                }
                const musics = event.musics?.[Server.cn]
                if (musics == undefined || musics.length == 0) {
                    return res.send(listToBase64([`错误: 活动${event.eventId}在${serverNameFullList[Server.cn]}没有歌榜数据`]));
                }
                if (eventType == 'challenge') {
                    //挑战活动: 缺省第1首, 越界报错并列出曲目
                    resolvedSongIndex = songIndex ?? 1
                    if (resolvedSongIndex > musics.length) {
                        return res.send(listToBase64([`错误: 活动${event.eventId}的歌榜共${musics.length}首歌\n${eventMusicListText(event)}`]));
                    }
                }
                //组曲(medley)/对邦(versus): 忽略 songIndex
            }
            //玩家快照
            const player = new Player(uid, Server.cn)
            await player.initFull(false, 3)
            if (player.initError || !player.isExist) {
                return res.send(listToBase64([`错误: 未找到${serverNameFullList[Server.cn]}玩家 ${uid}, 请确认玩家ID正确且资料为公开状态`]));
            }
            const signatureText = signature != undefined ? String(signature).trim() : ''
            const degreeEntries = player.profile.userProfileDegreeMap?.entries
            const record: FinalRankingPlayer = {
                name: player.profile.userName,
                rank: player.profile.rank,
                introduction: signatureText != '' ? signatureText : (player.profile.introduction ?? ''),
                avatarSid: player.profile.userIllust.cardId,
                avatarStrained: player.profile.userIllust.trainingStatus ? 1 : 0,
                degrees: [degreeEntries?.first?.degreeId, degreeEntries?.second?.degreeId].filter((id) => id != undefined && id > 0),
                updatedAt: now,
            }
            if (recordedBy != undefined) {
                //仅在实际提供时写入, 避免 undefined 键在合并时清掉旧值
                record.recordedBy = String(recordedBy)
            }
            if (type == 'event') {
                record.ptRanking = ranking
                record.pt = pt
            }
            else {
                record.songRanking = ranking
                record.songScore = score
                if (resolvedSongIndex != undefined) {
                    record.songIndex = resolvedSongIndex
                }
            }
            await finalRankingDB.updatePlayer(event.eventId, platform, groupId, uid, record, groupName)
            const playerShort = `${player.profile.userName}(#${uid})`
            if (type == 'event') {
                return res.send(listToBase64([`已记录 PT榜结榜: 玩家 ${playerShort} 第${ranking}名 ${pt}PT [活动${event.eventId}]`]));
            }
            const songText = resolvedSongIndex != undefined ? ` 第${resolvedSongIndex}首` : ''
            return res.send(listToBase64([`已记录 歌榜结榜: 玩家 ${playerShort} 第${ranking}名 ${score}分${songText} [活动${event.eventId}]`]));
        } catch (e) {
            console.log(e);
            res.status(500).send({ status: 'failed', data: '内部错误' });
        }
    }
);

//查结榜图: 生成本群结榜图片, eventId 省略时取本群最新有记录的一期
router.post('/query',
    [
        body('platform').isString(),
        body('groupId').isString(),
        body('eventId').optional().isInt({ min: 1 }),
        body('groupName').optional().isString(),
        body('useEasyBG').isBoolean(),
    ],
    middleware,
    async (req: Request, res: Response) => {
        const { platform, groupId, eventId, groupName, useEasyBG } = req.body;
        try {
            const resolvedEventId = eventId != undefined ? eventId : await finalRankingDB.getLatestRecordedEventId(platform, groupId)
            if (resolvedEventId == null) {
                return res.send(listToBase64(['错误: 当前群还没有结榜数据']));
            }
            const data = await finalRankingDB.getGroupPlayers(resolvedEventId, platform, groupId)
            if (data == null) {
                return res.send(listToBase64([`错误: 本群暂无活动${resolvedEventId}的结榜数据`]));
            }
            if (data.players.filter((p) => p.ptRanking != undefined || p.songRanking != undefined).length == 0) {
                return res.send(listToBase64([`错误: 本群暂无活动${resolvedEventId}的结榜数据`]));
            }
            const event = new Event(resolvedEventId)
            if (!event.isExist) {
                return res.send(listToBase64([`错误: 活动${resolvedEventId}不存在`]));
            }
            //群名称优先用请求携带的(来自会话实时获取), 回退数据库快照
            const displayName = (groupName != undefined && String(groupName).trim() != '') ? String(groupName).trim() : (data.groupName ?? groupId)
            const result = await drawFinalRanking(event, data.players, {
                groupName: displayName,
                groupId: groupId,
                useEasyBG: useEasyBG
            })
            res.send(listToBase64(result));
        } catch (e) {
            console.log(e);
            res.status(500).send({ status: 'failed', data: '内部错误' });
        }
    }
);

//查结榜图 删除: 删除本群最新有记录的一期中该玩家的结榜数据
router.post('/delete',
    [
        body('platform').isString(),
        body('groupId').isString(),
        body('uid').isInt({ min: 1 }),
    ],
    middleware,
    async (req: Request, res: Response) => {
        const { platform, groupId, uid } = req.body;
        try {
            const latestEventId = await finalRankingDB.getLatestRecordedEventId(platform, groupId)
            if (latestEventId == null) {
                return res.send(listToBase64(['错误: 当前群还没有结榜数据']));
            }
            const deleted = await finalRankingDB.deletePlayer(latestEventId, platform, groupId, uid)
            if (!deleted) {
                return res.send(listToBase64([`错误: 活动${latestEventId}的结榜数据中没有玩家 ${uid}`]));
            }
            res.send(listToBase64([`已删除 活动${latestEventId} 中玩家 ${uid} 的结榜数据`]));
        } catch (e) {
            console.log(e);
            res.status(500).send({ status: 'failed', data: '内部错误' });
        }
    }
);

export { router as finalRankingRouter }
