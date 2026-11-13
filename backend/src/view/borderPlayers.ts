import { Canvas, Image } from 'skia-canvas'
import { drawTitle } from '@/components/title'
import { drawDatablock } from '@/components/dataBlock'
import { drawEventDatablock } from '@/components/dataBlock/event'
import { drawList } from '@/components/list'
import { drawPlayerRankingInList } from '@/components/list/playerRanking'
import { stackImage, stackImageHorizontal, resizeImage } from '@/components/utils'
import { outputFinalBuffer } from '@/image/output'
import { drawDottedLine } from '@/image/dottedLine'
import { Server } from '@/types/Server'
import { serverNameFullList } from '@/config'
import { Event, getPresentEvent } from '@/types/Event'
import { Song } from '@/types/Song'
import { MonthlyRanking } from '@/types/MonthlyRanking'
import {
    BorderPlayer,
    EventBorderPlayersResponse,
    MonthlyBorderPlayersResponse,
    fetchEventBorderPlayers,
    fetchMonthlyBorderPlayers
} from '@/api/borderPlayersSource'

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

//多列布局时列内使用的分隔线(列宽与玩家卡片原生宽度一致)
const columnWidth = 800
const lineColumn: Canvas = drawDottedLine({
    width: columnWidth,
    height: 30,
    startX: 5,
    startY: 15,
    endX: columnWidth - 5,
    endY: 15,
    radius: 2,
    gap: 10,
    color: "#a8a8a8"
})

function formatTime(time: number): string {
    return new Intl.DateTimeFormat('zh-CN', {
        timeZone: 'Asia/Shanghai',
        year: 'numeric', month: '2-digit', day: '2-digit',
        hour: '2-digit', minute: '2-digit', second: '2-digit',
        hour12: false
    }).format(new Date(time))
}

//歌榜分组标题: medley 的 musicId=1 为合计分数榜, 不是真实曲目, 需特判
function getMusicLabel(eventType: string, musicId: number): string {
    if (eventType == 'medley' && musicId == 1) {
        return '组曲合计'
    }
    const song = new Song(musicId)
    if (song.isExist) {
        const title = song.musicTitle[Server.cn] ?? song.musicTitle[Server.jp]
        if (title != null) {
            return title
        }
    }
    return `曲目 ${musicId}`
}

//过滤占位条目(如 5v5 活动的 uid=0 占位)后, 逐个绘制玩家卡片, 展示效果与查PT一致
//cardWidthMax 提供时将卡片等比缩放到该宽度, 否则保持原生 800px(多列布局使用)
async function drawBorderPlayerCards(players: BorderPlayer[], cardWidthMax?: number): Promise<Array<Image | Canvas>> {
    const list: Array<Image | Canvas> = []
    for (const player of players) {
        if (player.uid <= 0 || player.tier == undefined || player.point == undefined) {
            continue
        }
        const cardImage = await drawPlayerRankingInList({
            uid: player.uid,
            name: player.name ?? '',
            introduction: player.introduction ?? '',
            rank: player.rank,
            sid: player.sid,
            strained: player.strained,
            degrees: player.degrees ?? [],
            ranking: player.tier,
            currentPt: player.point
        }, 'white', Server.cn)
        if (cardImage != undefined) {
            if (cardWidthMax != undefined) {
                list.push(resizeImage({ image: cardImage, widthMax: cardWidthMax }))
            }
            else {
                list.push(cardImage)
            }
        }
    }
    return list
}

//解析活动: 省略活动 ID 时取当前国服活动(getPresentEvent 无进行中活动时回退最近结束的活动)
function resolveEvent(eventId: number | undefined): Event | null {
    if (eventId != undefined) {
        return new Event(eventId)
    }
    return getPresentEvent(Server.cn)
}

/*
 * 查广告位 / 查歌榜广告位
 * mode == 'event'  : 渲染 PT 榜广告位(eventPoint)
 * mode == 'music'  : 渲染歌榜广告位(musicRankings), 仅 CP(challenge)/组曲(medley)/对邦(versus) 活动有歌榜
 */
export async function drawEventBorderPlayers(eventId: number | undefined, useEasyBG: boolean, compress: boolean, mode: 'event' | 'music'): Promise<Array<Buffer | string>> {
    //解析活动 ID
    const event = resolveEvent(eventId)
    if (event == null || event.eventId == undefined) {
        return ['错误: 未找到当前进行中的国服活动']
    }
    //查询数据
    let data: EventBorderPlayersResponse
    try {
        data = await fetchEventBorderPlayers(event.eventId)
    }
    catch (e) {
        return [`错误: 查询广告位数据失败: ${e.message}`]
    }
    //歌榜模式: 校验活动类型
    if (mode == 'music') {
        if (data.eventType == 'mission_live') {
            return ['错误: 任务协力活动没有歌榜, 无法查询歌榜广告位']
        }
        if (data.eventType == 'live_try') {
            return ['错误: EX协力活动没有歌榜, 无法查询歌榜广告位']
        }
        if (data.eventType != 'challenge' && data.eventType != 'medley' && data.eventType != 'versus') {
            return [`错误: 该活动类型(${data.eventType})没有歌榜, 无法查询歌榜广告位`]
        }
        if (data.musicRankings == undefined || data.musicRankings.length == 0) {
            return ['错误: 该活动暂无歌榜广告位数据']
        }
    }
    else if (data.eventPoint == undefined || data.eventPoint.filter(player => player.uid > 0).length == 0) {
        return ['错误: 该活动暂无PT榜广告位数据']
    }

    const all: Array<Canvas | Image> = []
    all.push(drawTitle(mode == 'event' ? '查广告位' : '查歌榜广告位', `${serverNameFullList[Server.cn]}`))

    //活动详情
    if (event.isExist) {
        all.push(await drawEventDatablock(event, [Server.cn]))
    }

    if (mode == 'event') {
        //PT榜广告位
        const list: Array<Image | Canvas> = []
        list.push(drawList({ key: '查询时间', text: formatTime(data.time) }))
        const cards = await drawBorderPlayerCards(data.eventPoint, widthMax)
        if (cards.length == 0) {
            return ['错误: 该活动暂无PT榜广告位数据']
        }
        for (const card of cards) {
            list.push(line)
            list.push(card)
        }
        all.push(drawDatablock({ list, topLeftText: 'PT榜广告位', maxWidth: widthMax }))
    }
    else {
        //歌榜广告位: 收集有数据的歌榜分组
        const groups: Array<{ label: string, cards: Array<Image | Canvas> }> = []
        for (const musicRanking of data.musicRankings) {
            const cards = await drawBorderPlayerCards(musicRanking.players)
            if (cards.length > 0) {
                groups.push({ label: getMusicLabel(data.eventType, musicRanking.musicId), cards })
            }
        }
        if (groups.length == 0) {
            return ['错误: 该活动暂无歌榜广告位数据']
        }
        if (groups.length == 1) {
            //单曲(组曲/对邦): 单列全宽
            const list: Array<Image | Canvas> = []
            list.push(drawList({ key: '歌曲', text: groups[0].label }))
            list.push(line)
            list.push(drawList({ key: '查询时间', text: formatTime(data.time) }))
            for (const rawCard of groups[0].cards) {
                //与查广告位(PT榜)一致: 单列全宽时卡片缩放到 widthMax, 使右侧等级/uid/分数贴齐图片最右侧
                const card = resizeImage({ image: rawCard, widthMax: widthMax })
                list.push(line)
                list.push(card)
            }
            all.push(drawDatablock({ list, topLeftText: '歌榜广告位', maxWidth: widthMax }))
        }
        else {
            //多曲(CP 等): 每首歌一列并排展示, 卡片保持原生宽度
            const columnList: Array<Image | Canvas> = []
            for (const group of groups) {
                const columnContent: Array<Image | Canvas> = []
                columnContent.push(drawList({ key: '歌曲', text: group.label }))
                for (const card of group.cards) {
                    columnContent.push(lineColumn)
                    columnContent.push(card)
                }
                columnList.push(stackImage(columnContent))
                //列间距
                columnList.push(new Canvas(20, 1))
            }
            columnList.pop()
            const columns = stackImageHorizontal(columnList)
            const list: Array<Image | Canvas> = []
            list.push(drawList({ key: '查询时间', text: formatTime(data.time), maxWidth: columns.width }))
            list.push(line)
            list.push(columns)
            all.push(drawDatablock({ list, topLeftText: '歌榜广告位', maxWidth: columns.width }))
        }
    }

    const buffer = await outputFinalBuffer({ imageList: all, useEasyBG: useEasyBG, compress: compress })
    return [buffer]
}

/*
 * 查月榜广告位
 * monthlyId 省略时由上游自动解析当前月榜期(间隔期回退最近结束一期)
 */
export async function drawMonthlyBorderPlayers(monthlyId: number | undefined, useEasyBG: boolean, compress: boolean): Promise<Array<Buffer | string>> {
    let data: MonthlyBorderPlayersResponse
    try {
        data = await fetchMonthlyBorderPlayers(monthlyId)
    }
    catch (e) {
        return [`错误: 查询月榜广告位数据失败: ${e.message}`]
    }
    if (data.players == undefined || data.players.filter(player => player.uid > 0).length == 0) {
        return ['错误: 该月榜暂无广告位数据']
    }

    const all: Array<Canvas | Image> = []
    all.push(drawTitle('查月榜广告位', `${serverNameFullList[Server.cn]}`))

    //月榜信息
    {
        const monthly = new MonthlyRanking(data.monthlyId)
        const monthlyName = monthly.isExist
            ? (monthly.monthlyRankingName[Server.cn] ?? monthly.monthlyRankingName[Server.jp])
            : undefined
        const list: Array<Image | Canvas> = []
        list.push(drawList({ key: '月榜期号', text: `第 ${data.monthlyId} 期` }))
        if (monthlyName != null && monthlyName != undefined) {
            list.push(line)
            list.push(drawList({ key: '月榜名称', text: monthlyName }))
        }
        list.push(line)
        list.push(drawList({ key: '查询时间', text: formatTime(data.time) }))
        all.push(drawDatablock({ list, topLeftText: '月榜信息', maxWidth: widthMax }))
    }

    //月榜广告位
    {
        const list: Array<Image | Canvas> = []
        const cards = await drawBorderPlayerCards(data.players, widthMax)
        for (const card of cards) {
            list.push(line)
            list.push(card)
        }
        all.push(drawDatablock({ list, topLeftText: '月榜广告位', maxWidth: widthMax }))
    }

    const buffer = await outputFinalBuffer({ imageList: all, useEasyBG: useEasyBG, compress: compress })
    return [buffer]
}
