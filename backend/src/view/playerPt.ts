import { Canvas, Image } from 'skia-canvas'
import { drawTitle } from '@/components/title'
import { drawDatablock } from '@/components/dataBlock'
import { drawEventDatablock } from '@/components/dataBlock/event'
import { drawList, drawListMerge } from '@/components/list'
import { drawPlayerRankingInList } from '@/components/list/playerRanking'
import { stackImage } from '@/components/utils'
import { outputFinalBuffer } from '@/image/output'
import { drawDottedLine } from '@/image/dottedLine'
import { resizeImage } from '@/components/utils'
import { Server } from '@/types/Server'
import { serverNameFullList } from '@/config'
import { Event } from '@/types/Event'
import { fetchLocalPlayerPt, PlayerPtCreds, PlayerPtData, PlayerPtRankingUser } from '@/api/playerPtSource'
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

//near 表格单元格宽度(等分三列, 留出边距)
const nearCellMaxWidth = Math.floor(widthMax / 3) - 60

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

//绘制邻近排名表格(纵向: 表头 + 每行一条 排名/名称/PT)
function drawNearTable(nearList: PlayerPtRankingUser[], userId: number): Canvas {
    const list: Array<Image | Canvas> = []
    if (nearList.length == 0) {
        list.push(drawList({ text: '暂无邻近排名数据' }))
        return stackImage(list)
    }
    //表头
    list.push(drawListMerge([
        drawList({ key: '排名' }),
        drawList({ key: '名称' }),
        drawList({ key: 'PT' })
    ], widthMax))
    //数据行, 按位次排序, 玩家本人行高亮
    const sorted = [...nearList].sort((a, b) => a.tier - b.tier)
    for (const entry of sorted) {
        list.push(line)
        const color = isSelf(entry, userId) ? '#ea4e73' : undefined
        list.push(drawListMerge([
            drawList({ text: '#' + entry.tier, color, maxWidth: nearCellMaxWidth }),
            drawList({ text: entry.name, color, maxWidth: nearCellMaxWidth }),
            drawList({ text: String(entry.point), color, maxWidth: nearCellMaxWidth })
        ], widthMax))
    }
    return stackImage(list)
}

export async function drawPlayerPt(playerId: number, useEasyBG: boolean, compress: boolean, creds: PlayerPtCreds, platform?: string): Promise<{ result: Array<Buffer | string>; platform?: string }> {
    let data: PlayerPtData
    let apiPlatform: string | undefined
    try {
        const fetched = await fetchLocalPlayerPt(playerId, creds, platform)
        data = fetched.data
        apiPlatform = fetched.platform
    }
    catch (e) {
        return { result: [`错误: 查询PT数据失败: ${e.message}`] }
    }
    if (data == undefined || data.userId == undefined) {
        return { result: [`错误: 未查询到玩家 ${playerId} 的PT数据`], platform: apiPlatform }
    }
    const event = data.event
    const monthly = data.monthly
    if (event?.point == undefined && (monthly == undefined || monthly.point == null)) {
        return { result: [`错误: 未查询到玩家 ${playerId} 的PT数据, 请确认玩家ID是否正确`], platform: apiPlatform }
    }

    //玩家名称: 优先取邻近排名中玩家本人条目, 否则回退玩家档案接口
    const selfEntry = event?.near?.find(entry => entry.uid == data.userId)
        ?? monthly?.near?.find(entry => entry.uid == data.userId)
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
            logger('playerPt', `玩家档案获取失败: ${e.message}`)
        }
    }

    const all: Array<Canvas | Image> = []
    all.push(drawTitle('查PT', `${serverNameFullList[Server.cn]}`))

    //玩家信息
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
        all.push(drawDatablock({ list, topLeftText: '玩家信息', maxWidth: widthMax }))
    }

    //活动详情
    const eventInfo = event?.info
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

    //活动PT与邻近排名
    {
        const list: Array<Image | Canvas> = []
        list.push(drawList({ key: '当前排名', text: event.rank == null ? '未上榜' : '#' + event.rank }))
        list.push(line)
        list.push(drawList({ key: '当前PT', text: event.point != undefined ? String(event.point) : '未知' }))
        list.push(line)
        list.push(drawList({ key: '查询时间', text: formatTime(data.time) }))
        list.push(line)
        list.push(drawNearTable(event?.near ?? [], data.userId))
        all.push(drawDatablock({ list, topLeftText: '活动PT', maxWidth: widthMax }))
    }

    //月榜 (只包含PT与排名)
    if (monthly != undefined) {
        const list: Array<Image | Canvas> = []
        list.push(drawList({ key: '当前排名', text: monthly.rank == null ? '未上榜' : '#' + monthly.rank }))
        list.push(line)
        list.push(drawList({ key: '当前PT', text: monthly.point == null ? '未上榜' : String(monthly.point) }))
        all.push(drawDatablock({ list, topLeftText: '月榜PT', maxWidth: widthMax }))
    }

    var buffer = await outputFinalBuffer({ imageList: all, useEasyBG: useEasyBG, compress: compress })

    return { result: [buffer], platform: apiPlatform };
}
