import { Session } from 'koishi'
import { getReplyFromBackend } from "../api/getReplyFromBackend"
import { Config } from '../config';

/*
 * 结榜图 / 歌榜结榜图 / 查结榜图
 * 数据经由后端 /finalRanking/* 端点读写(后端负责活动解析, 时限校验与渲染)
 */

//结榜图 / 歌榜结榜图: 提交结榜成绩(后端校验时限并归档到最近结束的活动)
//groupName 随提交存储, 供查结榜图在会话获取群名失败时兜底
export async function commandFinalRankingSubmit(config: Config, platform: string, groupId: string, groupName: string | undefined, type: 'event' | 'music', uid: number, ranking: number, value: number, songIndex: number | undefined, signature: string | undefined, recordedBy: string | undefined): Promise<Array<Buffer | string>> {
    return await getReplyFromBackend(`${config.backendUrl}/finalRanking/submit`, {
        platform,
        groupId,
        groupName,
        type,
        uid,
        ranking,
        pt: type == 'event' ? value : undefined,
        score: type == 'music' ? value : undefined,
        songIndex,
        signature,
        recordedBy,
    })
}

//查结榜图: 生成本群结榜图片, eventId 省略时后端取本群最新有记录的一期
//图片恒定输出 PNG(与微操计算一致), 不传 compress
export async function commandFinalRankingQuery(config: Config, platform: string, groupId: string, groupName: string | undefined, eventId: number | undefined): Promise<Array<Buffer | string>> {
    return await getReplyFromBackend(`${config.backendUrl}/finalRanking/query`, {
        platform,
        groupId,
        groupName,
        eventId,
        useEasyBG: config.useEasyBG
    })
}

//查结榜图 删除: 删除本群最新有记录的一期中该玩家的结榜数据
export async function commandFinalRankingDelete(config: Config, platform: string, groupId: string, uid: number): Promise<Array<Buffer | string>> {
    return await getReplyFromBackend(`${config.backendUrl}/finalRanking/delete`, {
        platform,
        groupId,
        uid,
    })
}

//获取群名称, 各级获取失败时回退为群号
export async function getGroupName(session: Session): Promise<string> {
    const eventName = session.event?.guild?.name
    if (eventName != undefined && eventName != '') {
        return eventName
    }
    try {
        const guild = await session.bot.getGuild(session.guildId)
        if (guild?.name != undefined && guild.name != '') {
            return guild.name
        }
    }
    catch { }
    return session.guildId
}

//角色条目可能是字符串(旧版 satori/部分适配器)或对象(新版协议 {id, name}), 两种形状都兼容
function matchAdminRole(role: unknown): boolean {
    if (typeof role == 'string') {
        return role == 'owner' || role == 'admin'
    }
    if (role != null && typeof role == 'object') {
        const roleObject = role as { id?: unknown, name?: unknown }
        const id = typeof roleObject.id == 'string' ? roleObject.id.toLowerCase() : ''
        const name = typeof roleObject.name == 'string' ? roleObject.name.toLowerCase() : ''
        return id == 'owner' || id == 'admin' || name == 'owner' || name == 'admin' || name == '群主' || name == '管理员'
    }
    return false
}

//判断发起者是否群主/管理员: true=是, false=否, 'unknown'=无法判定
export async function checkGroupAdmin(session: Session): Promise<boolean | 'unknown'> {
    const roles: readonly unknown[] | undefined = session.event?.member?.roles
    if (roles != undefined && roles.length > 0) {
        return roles.some((role) => matchAdminRole(role))
    }
    try {
        const member = await session.bot.getGuildMember(session.guildId, session.userId)
        const memberRoles: readonly unknown[] | undefined = member?.roles
        if (memberRoles != undefined && memberRoles.length > 0) {
            return memberRoles.some((role) => matchAdminRole(role))
        }
    }
    catch { }
    return 'unknown'
}
