import { Canvas, Image } from 'skia-canvas'
import { drawTitle } from '@/components/title'
import { drawDatablock } from '@/components/dataBlock'
import { drawEventDatablock } from '@/components/dataBlock/event'
import { drawList, drawListMerge } from '@/components/list'
import { drawPlayerRankingInList } from '@/components/list/playerRanking'
import { drawSongInList } from '@/components/list/song'
import { stackImage, resizeImage } from '@/components/utils'
import { outputFinalBuffer } from '@/image/output'
import { drawDottedLine } from '@/image/dottedLine'
import { Server } from '@/types/Server'
import { serverNameFullList } from '@/config'
import { Event } from '@/types/Event'
import { Song } from '@/types/Song'
import { fetchLocalPlayerMusic, PlayerMusicData } from '@/api/playerMusicSource'
import { PlayerPtCreds, PlayerPtRankingUser } from '@/api/playerPtSource'
import { fetchPlayerDataPreferLocal } from '@/api/playerSource'
import { logger } from '@/logger'

const widthMax = 1000

const line: Canvas = drawDottedLine({
    width: widthMax,
    height: 30,
    startX: 5,
    startY: 15,
    endX: widthMax - 5,
    endY: 15,
    radius: 2,
    gap: 10,
    color: "#a8a8a8"
})

//near 表格列宽: 排名列收窄, 名称列放宽(一行至少容纳 8 个汉字, 40px 字号约 320px), 分数列适中
const nearColumnWidths = [200, 500, 300]

function formatTime(time: number): string {
    return new Intl.DateTimeFormat('zh-CN', {
        timeZone: 'Asia/Shanghai',
        year: 'numeric', month: '2-digit', day: '2-digit',
        hour: '2-digit', minute: '2-digit', second: '2-digit',
        hour12: false
    }).format(new Date(time))
}

//near 条目中可能是玩家本人, 用高亮色标记
function isSelf(entry: PlayerPtRankingUser, userId: number): boolean {
    return entry.uid == userId
}

//绘制邻近排名表格(纵向: 表头 + 每行一条 排名/名称/分数)
//与查PT 的 drawNearTable 同构, 列头为 分数(歌榜 point 为分数维度)
function drawNearTable(nearList: PlayerPtRankingUser[], userId: number): Canvas {
    const list: Array<Image | Canvas> = []
    if (nearList.length == 0) {
        list.push(drawList({ text: '暂无邻近排名数据' }))
        return stackImage(list)
    }
    //表头
    list.push(drawListMerge([
        drawList({ key: '排名', maxWidth: nearColumnWidths[0] }),
        drawList({ key: '名称', maxWidth: nearColumnWidths[1] }),
        drawList({ key: '分数', maxWidth: nearColumnWidths[2] })
    ], widthMax, false, 'top', nearColumnWidths))
    //数据行, 按位次排序, 玩家本人行高亮
    const sorted = [...nearList].sort((a, b) => a.tier - b.tier)
    for (const entry of sorted) {
        list.push(line)
        const color = isSelf(entry, userId) ? '#ea4e73' : undefined
        list.push(drawListMerge([
            drawList({ text: '#' + entry.tier, color, maxWidth: nearColumnWidths[0] }),
            drawList({ text: entry.name, color, maxWidth: nearColumnWidths[1] }),
            drawList({ text: String(entry.point), color, maxWidth: nearColumnWidths[2] })
        ], widthMax, false, 'top', nearColumnWidths))
    }
    return stackImage(list)
}

//曲名行: 查 Song 展示封面与曲名, Bestdori 未收录时回退纯文本
async function drawMusicTitleRow(musicId: number): Promise<Image | Canvas> {
    const song = new Song(musicId)
    if (song.isExist) {
        return await drawSongInList(song, undefined, undefined, [Server.cn])
    }
    return drawList({ key: '曲目', text: `曲目 ${musicId}` })
}

//纯渲染: 数据 → 图片 buffer 列表(供 drawPlayerMusic 与样例生成脚本共用)
export async function drawPlayerMusicData(data: PlayerMusicData, useEasyBG: boolean, compress: boolean): Promise<Array<Buffer | string>> {
    //本人条目: 优先取 near 中本人条目(用于玩家信息卡与昵称), 否则昵称回退玩家档案接口
    const selfEntry = data.musics
        ?.map(music => music.near?.find(entry => entry.uid == data.userId))
        .find(entry => entry != undefined)
    let playerName = selfEntry?.name
    if (!playerName) {
        try {
            const profileData = await fetchPlayerDataPreferLocal(Server.cn, data.userId, 3, 60000) as {
                data?: {
                    profile?: {
                        userName?: string
                    }
                }
            }
            playerName = profileData?.data?.profile?.userName
        }
        catch (e) {
            logger('playerMusic', `玩家档案获取失败: ${e.message}`)
        }
    }

    const all: Array<Canvas | Image> = []
    all.push(drawTitle('查歌榜', `${serverNameFullList[Server.cn]}`))

    //玩家信息(与查PT一致: 本人条目 → 排名卡, 否则 玩家ID+昵称;查询时间另起一行)
    {
        const list: Array<Image | Canvas> = []
        if (selfEntry != undefined && selfEntry.sid != undefined) {
            const playerCardImage = await drawPlayerRankingInList({
                uid: selfEntry.uid,
                name: selfEntry.name,
                introduction: selfEntry.introduction ?? '',
                rank: selfEntry.rank,
                sid: selfEntry.sid,
                strained: selfEntry.strained,
                degrees: selfEntry.degrees ?? [],
                ranking: selfEntry.tier,
                currentPt: selfEntry.point
            }, 'white', Server.cn)
            if (playerCardImage != undefined) {
                list.push(resizeImage({ image: playerCardImage, widthMax }))
            }
        }
        if (list.length == 0) {
            list.push(drawList({ key: '玩家ID', text: String(data.userId) }))
            list.push(line)
            list.push(drawList({ key: '昵称', text: playerName ?? '未知' }))
        }
        list.push(line)
        list.push(drawList({ key: '查询时间', text: formatTime(data.time) }))
        all.push(drawDatablock({ list, topLeftText: '玩家信息', maxWidth: widthMax }))
    }

    //活动详情
    const eventInfo = data.event
    if (eventInfo != undefined) {
        const bestdoriEvent = new Event(eventInfo.eventId)
        if (bestdoriEvent.isExist) {
            all.push(await drawEventDatablock(bestdoriEvent, [Server.cn]))
        }
        else {
            //Bestdori 暂无该活动时, 使用数据源自带的活动信息
            all.push(drawDatablock({
                list: [
                    drawList({ key: '活动名称', text: eventInfo.eventName }),
                    line,
                    drawList({ key: '活动ID', text: `${eventInfo.eventId} (${eventInfo.eventType})` }),
                    line,
                    drawList({ key: '开始时间', text: formatTime(eventInfo.startAt) }),
                    line,
                    drawList({ key: '结束时间', text: formatTime(eventInfo.endAt) }),
                ],
                topLeftText: '活动详情',
                maxWidth: widthMax
            }))
        }
    }

    //每曲歌榜(逐曲透传响应条目, 数量不硬编码): 曲名行 + 邻近排名表
    //medley(合计榜, musicId=1 非真实曲目)不显示歌曲信息行;曲内仅 near 表, 不重复展示当前排名/分数
    const isMedley = data.event?.eventType == 'medley'
    const musics = data.musics ?? []
    for (let i = 0; i < musics.length; i++) {
        const music = musics[i]
        const list: Array<Image | Canvas> = []
        if (!isMedley) {
            list.push(await drawMusicTitleRow(music.musicId))
            list.push(line)
        }
        list.push(drawNearTable(music.near ?? [], data.userId))
        all.push(drawDatablock({ list, topLeftText: `歌曲排名 ${i + 1}/${musics.length}`, maxWidth: widthMax }))
    }

    //空歌榜软降级: 上游失败或当前活动无歌榜时 musics 为空, 照常渲染已有信息
    if (musics.length == 0) {
        all.push(drawDatablock({
            list: [
                drawList({ text: '暂无歌榜数据, 当前活动可能无歌曲排名或数据源查询失败' })
            ],
            topLeftText: '歌榜数据',
            maxWidth: widthMax
        }))
    }

    const buffer = await outputFinalBuffer({ imageList: all, useEasyBG: useEasyBG, compress: compress })

    return [buffer];
}

export async function drawPlayerMusic(playerId: number, useEasyBG: boolean, compress: boolean, creds: PlayerPtCreds, platform?: string): Promise<{ result: Array<Buffer | string>; platform?: string }> {
    let data: PlayerMusicData
    let apiPlatform: string | undefined
    try {
        const fetched = await fetchLocalPlayerMusic(playerId, creds, platform)
        data = fetched.data
        apiPlatform = fetched.platform
    }
    catch (e) {
        return { result: [`错误: 查询歌榜数据失败: ${e.message}`] }
    }
    if (data == undefined || data.userId == undefined) {
        return { result: [`错误: 未查询到玩家 ${playerId} 的歌榜数据`], platform: apiPlatform }
    }
    return { result: await drawPlayerMusicData(data, useEasyBG, compress), platform: apiPlatform }
}
