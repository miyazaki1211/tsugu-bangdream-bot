import { Canvas, Image } from 'skia-canvas'
import { drawTitle } from '@/components/title'
import { drawDatablock } from '@/components/dataBlock'
import { drawEventDatablock } from '@/components/dataBlock/event'
import { drawList } from '@/components/list'
import { drawPlayerRankingInList } from '@/components/list/playerRanking'
import { resizeImage } from '@/components/utils'
import { outputFinalBuffer } from '@/image/output'
import { drawDottedLine } from '@/image/dottedLine'
import { Server } from '@/types/Server'
import { Event } from '@/types/Event'
import { Song } from '@/types/Song'
import { FinalRankingPlayerWithUid } from '@/database/finalRankingDB'

/*
 * 查结榜图渲染: 布局与查广告位保持一致
 * 标题(含群名称群号) → 活动信息 → PT榜(按排名升序) → 歌榜(歌曲分组纵向排列, 组内按排名升序)
 * 所有卡片数据来自结榜时刻的快照, 不重新拉取 bestdori
 * 图片恒定输出 PNG 不压缩(与微操计算一致, 不受压缩配置影响)
 */

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

//歌榜分组标题: 优先取活动曲目名, medley 为合计分数榜; 活动数据不可用时回退"第N首"
function getMusicLabel(event: Event | null, songIndex: number): string {
    if (event != null && event.eventType == 'medley') {
        return '组曲合计'
    }
    const musics = event?.musics?.[Server.cn]
    const musicEntry = musics?.[Math.min(songIndex, musics.length) - 1]
    if (musicEntry != undefined) {
        const song = new Song(musicEntry.musicId)
        if (song.isExist) {
            const title = song.musicTitle[Server.cn] ?? song.musicTitle[Server.jp]
            if (title != null) {
                return title
            }
        }
        return `曲目 ${musicEntry.musicId}`
    }
    return `第${songIndex}首`
}

//渲染单张玩家卡片(数据全部来自快照), 缩放至 widthMax 与查广告位一致
async function drawFinalRankingCard(player: FinalRankingPlayerWithUid, ranking: number, point: number): Promise<Image | Canvas> {
    const cardImage = await drawPlayerRankingInList({
        uid: player.uid,
        name: player.name ?? '',
        introduction: player.introduction ?? '',
        rank: player.rank,
        sid: player.avatarSid,
        strained: player.avatarStrained,
        degrees: player.degrees ?? [],
        ranking: ranking,
        currentPt: point
    }, 'white', Server.cn)
    if (cardImage == undefined) {
        return undefined
    }
    return resizeImage({ image: cardImage, widthMax: widthMax })
}

/*
 * 查结榜图
 * players: 该群该期的全部玩家快照记录
 */
export async function drawFinalRanking(
    event: Event,
    players: FinalRankingPlayerWithUid[],
    info: { groupName: string, groupId: string, useEasyBG: boolean }
): Promise<Array<Buffer | string>> {
    //PT榜: 按排名升序, 并列按PT降序、uid升序
    const ptPlayers = players
        .filter((player) => player.ptRanking != undefined && player.pt != undefined)
        .sort((a, b) => a.ptRanking - b.ptRanking || b.pt - a.pt || a.uid - b.uid)
    //歌榜: 按歌曲序号分组, 组内按排名升序, 并列按分数降序、uid升序
    const songGroups = new Map<number, FinalRankingPlayerWithUid[]>()
    for (const player of players) {
        if (player.songRanking == undefined || player.songScore == undefined) {
            continue
        }
        const songIndex = player.songIndex ?? 1
        const group = songGroups.get(songIndex) ?? []
        group.push(player)
        songGroups.set(songIndex, group)
    }
    for (const [, group] of songGroups) {
        group.sort((a, b) => a.songRanking - b.songRanking || b.songScore - a.songScore || a.uid - b.uid)
    }
    const sortedSongIndexes = Array.from(songGroups.keys()).sort((a, b) => a - b)

    const all: Array<Canvas | Image> = []
    all.push(drawTitle('查结榜图', `${info.groupName}(${info.groupId})`))

    //活动详情(与查广告位一致)
    if (event.isExist) {
        await event.initFull()
        all.push(await drawEventDatablock(event, [Server.cn]))
    }

    //PT榜
    if (ptPlayers.length > 0) {
        const list: Array<Image | Canvas> = []
        for (const player of ptPlayers) {
            const card = await drawFinalRankingCard(player, player.ptRanking, player.pt)
            if (card != undefined) {
                list.push(line)
                list.push(card)
            }
        }
        all.push(drawDatablock({ list, topLeftText: 'PT榜', maxWidth: widthMax }))
    }

    //歌榜(放在PT榜下面, 歌曲分组纵向排列)
    if (sortedSongIndexes.length > 0) {
        const list: Array<Image | Canvas> = []
        for (const songIndex of sortedSongIndexes) {
            list.push(drawList({ key: '歌曲', text: getMusicLabel(event, songIndex) }))
            for (const player of songGroups.get(songIndex)) {
                const card = await drawFinalRankingCard(player, player.songRanking, player.songScore)
                if (card != undefined) {
                    list.push(line)
                    list.push(card)
                }
            }
        }
        all.push(drawDatablock({ list, topLeftText: '歌榜', maxWidth: widthMax }))
    }

    //恒定输出 PNG, 不做有损压缩(与微操计算保持一致)
    const buffer = await outputFinalBuffer({ imageList: all, useEasyBG: info.useEasyBG, compress: false })
    return [buffer]
}
