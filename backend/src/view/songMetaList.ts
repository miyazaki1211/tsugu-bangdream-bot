import { Song, getMetaRanking, DifficultyFilter } from "@/types/Song";
import { Canvas } from 'skia-canvas'
import { drawTitle } from '@/components/title';
import { outputFinalBuffer } from '@/image/output'
import { drawSongInList } from '@/components/list/song';
import { drawDottedLine } from '@/image/dottedLine';
import { Server } from '@/types/Server';
import { serverNameFullList } from '@/config';
import { drawDatablock } from '@/components/dataBlock'
import { stackImageHorizontal } from '@/components/utils'

// 紧凑化虚线分割
const line = drawDottedLine({
    width: 800,
    height: 10,
    startX: 5,
    startY: 5,
    endX: 795,
    endY: 5,
    radius: 2,
    gap: 10,
    color: "#a8a8a8"
})

export async function drawSongMetaList(mainServer: Server, compress: boolean, fever: boolean = true, scoreUpMaxValue: number = 150, skillDuration: number = 7, difficultyFilter?: DifficultyFilter): Promise<Array<Buffer | string>> {
    const imageList = []
    const datablock = await drawMetaRankListDatablock(fever, mainServer, scoreUpMaxValue, skillDuration, difficultyFilter)
    //没有符合条件的曲目时, 直接返回错误文本
    if (typeof datablock == 'string') {
        return [datablock]
    }
    imageList.push(datablock)
    var all = []
    all.push(drawTitle('查询', `${serverNameFullList[mainServer]} 分数排行榜`))
    all.push(imageList[0])
    var buffer = await outputFinalBuffer({
        imageList: all,
        useEasyBG: true,
        compress:compress
    })
    return [buffer]
}

async function drawMetaRankListDatablock(Fever: boolean, mainServer: Server, scoreUpMaxValue: number, skillDuration: number, difficultyFilter?: DifficultyFilter): Promise<Canvas | string> {
    const metaRanking = getMetaRanking(Fever, mainServer, scoreUpMaxValue, skillDuration);
    const maxMeta = metaRanking[0].meta
    let topLeftText = `${Fever ? '有Fever' : '无Fever'} ${scoreUpMaxValue}% ${skillDuration}秒`
    if (difficultyFilter != undefined) {
        topLeftText += ` 难度${difficultyFilter.op}${difficultyFilter.value}`
    }
    let listLeft: Array<Canvas> = []
    let listRight: Array<Canvas> = []
    const max = 100
    let shown = 0
    for (let i = 0; i < metaRanking.length && shown < max; i++) {
        let song = new Song(metaRanking[i].songId)
        let difficultyId = metaRanking[i].difficulty
        //难度过滤只影响展示的曲目, 不修改排名(rank)与相对分数基准(maxMeta)
        if (difficultyFilter != undefined) {
            const playLevel = song.difficulty[difficultyId]?.playLevel
            if (typeof playLevel != 'number') {
                continue
            }
            if (difficultyFilter.op == '<' ? !(playLevel < difficultyFilter.value) : !(playLevel > difficultyFilter.value)) {
                continue
            }
        }
        let precent = metaRanking[i].meta / maxMeta * 100
        precent = Math.round(precent * 100) / 100
        const itemImage = await drawSongInList(song, difficultyId, `相对分数: ${precent}% #${metaRanking[i].rank + 1}`)
        //前50首在左边，后50首在右边
        if (shown < 50) {
            listLeft.push(itemImage)
            listLeft.push(line)
        }
        else {
            listRight.push(itemImage)
            listRight.push(line)
        }
        shown++
    }
    if (shown == 0) {
        return '错误: 没有符合难度过滤条件的曲目'
    }
    listLeft.pop()
    const leftBlock = drawDatablock({ list: listLeft, topLeftText })
    //不足51首时，只绘制左列
    if (listRight.length == 0) {
        return leftBlock
    }
    listRight.pop()
    //右侧不带角标，顶部加70px透明占位使两列行对齐
    listRight.unshift(new Canvas(1, 70))
    const rightBlock = drawDatablock({ list: listRight })
    return stackImageHorizontal([leftBlock, rightBlock])
}

