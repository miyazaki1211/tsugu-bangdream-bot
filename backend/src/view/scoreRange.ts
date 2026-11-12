import { Event } from '@/types/Event';
import { drawList, drawListMerge, drawListTextWithImages, drawBandItemContent, drawAttributeItemContent } from '@/components/list';
import { drawDatablock } from '@/components/dataBlock';
import { Canvas } from 'skia-canvas';
import { drawTitle } from '@/components/title';
import { outputFinalBuffer } from '@/image/output';
import { drawCardIcon } from '@/components/card';
import { Card } from '@/types/Card';
import { statConfig } from '@/components/list/stat';
import { drawText } from '@/image/text';
import { Song } from '@/types/Song';
import { drawSongInListMid } from '@/components/list/song';
import { Server, getServerByPriority } from '@/types/Server';
import { globalDefaultServer } from '@/config';
import { playerDetail } from '@/types/BuildTypes';
import { ScoreRangeResult, SelectedAreaItems } from '@/types/PtTypes';

const DEFAULT_ITEMS: SelectedAreaItems = {
    band: '1000',
    attribute: '~all',
    magazine: 'performance',
};

function normalizeMagazine(value?: string): string {
    if (value === 'performance' || value === 'technique' || value === 'visual') {
        return value
    }
    return DEFAULT_ITEMS.magazine
}

//火倍率 → 演出一曲消耗的火 (1/5/10/15倍分别消耗0/1/2/3火)
const fireMultiplierToCost: { [multiplier: number]: number } = {
    1: 0,
    5: 1,
    10: 2,
    15: 3,
};

type CardConfig = {
    illustTrainingStatus?: boolean;
    limitBreakRank?: number;
    skillLevel?: number;
};

async function drawCardIconDefault(cardId: number, cardConfig?: CardConfig) {
    return drawCardIcon({
        card: new Card(cardId),
        trainingStatus: true,
        illustTrainingStatus: cardConfig?.illustTrainingStatus ?? true,
        limitBreakRank: cardConfig?.limitBreakRank ?? 0,
        cardIdVisible: true,
        skillTypeVisible: true,
        cardTypeVisible: false,
        skillLevel: cardConfig?.skillLevel ?? 1,
    });
}

async function drawItemsBlock(
    items: SelectedAreaItems,
    width: number,
): Promise<Array<Canvas>> {
    const list: Array<Canvas> = [];

    const bandId = items.band;
    //optimize 的 items.band 可能是 "1000"(全部)、单个乐队id 或逗号分隔的多乐队id
    const bandItemImage = drawListTextWithImages({
        key: '乐队道具',
        content: await drawBandItemContent(bandId),
    });

    const attribute = items.attribute;
    const attributeItemImage = drawListTextWithImages({
        key: '颜色道具',
        content: await drawAttributeItemContent(attribute),
        lineSpacing: 40,
    });

    const magazine = normalizeMagazine(items.magazine);
    const magazineItemImage = drawListTextWithImages({
        key: '杂志道具',
        content: [statConfig[magazine]?.name ?? magazine],
        lineSpacing: 40,
    });

    list.push(drawListMerge([bandItemImage, attributeItemImage, magazineItemImage], width));

    return list;
}

interface drawScoreRangeResultOptions {
    eventId: number;
    results: ScoreRangeResult[];
    currentPt: number;
    targetTotalPt: number;
    supportStat: number | null;
    useEasyBG: boolean;
    compress: boolean;
    player?: playerDetail;
}

export async function drawScoreRangeResult({
    eventId,
    results,
    currentPt,
    targetTotalPt,
    supportStat,
    useEasyBG,
    compress,
    player,
}: drawScoreRangeResultOptions): Promise<Buffer[]> {
    const event = new Event(eventId);
    await event.initFull();
    const width = 1020;

    const all: Array<Canvas> = [];

    // 标题
    all.push(drawTitle('控分', '计算'));

    // ── 控分概况 ──
    {
        const summaryList: Array<Canvas> = [];
        // 组曲活动只打第一曲, 其余活动均为自动演出
        const tipText = event.eventType == 'medley'
            ? '自动演出第一曲后就退出, 演出前请确认综合力、卡牌、基建与方案保持一致'
            : '均为自动演出, 演出前请确认综合力、卡牌、基建与方案保持一致';
        summaryList.push(drawList({
            key: '提示',
            text: tipText,
            maxWidth: width,
        }));
        summaryList.push(drawList({ key: '活动', text: `${eventId} ${event.getTypeName()}` }));
        summaryList.push(drawListMerge([
            drawList({ key: '当前PT', text: currentPt.toLocaleString() }),
            drawList({ key: '目标PT', text: targetTotalPt.toLocaleString() }),
            drawList({ key: '还需PT', text: results[0].targetDeltaPt.toLocaleString() }),
        ], width));
        // 仅任务live显示支援综合力
        if (results[0].eventType == 'mission_live' && supportStat != null) {
            summaryList.push(drawList({ key: '支援综合力', text: supportStat.toLocaleString() }));
        }
        all.push(drawDatablock({ list: summaryList }));
    }

    // ── 各方案 ──
    const cardList = player?.cardList;
    for (let i = 0; i < results.length; i++) {
        const result = results[i];
        const list: Array<Canvas> = [];

        // 第一行: 演奏次数 + 火耗 + 综合力 + PT加成
        list.push(drawListMerge([
            drawList({ key: '演奏次数', text: `${result.playCount} 次` }),
            drawList({ key: '火耗', text: `${result.totalFireCost}` }),
            drawList({ key: '综合力', text: result.totalStat.toLocaleString() }),
            drawList({ key: 'PT加成', text: `${result.pointBonusBasisPoints / 100}%` }),
        ], width));

        // 歌曲 (封面+难度 + 曲名/次数/火倍率/得分/PT)
        for (let j = 0; j < result.plays.length; j++) {
            const play = result.plays[j];
            const song = new Song(play.songId);
            const server = getServerByPriority(song.publishedAt, globalDefaultServer) ?? 0
            const songTitle = song.musicTitle[server] ?? `ID:${play.songId}`;
            list.push(drawListTextWithImages({
                key: result.plays.length > 1 ? `歌曲${j + 1}` : '歌曲',
                content: [
                    await drawSongInListMid(song, play.difficulty),
                    drawText({
                        text: `${songTitle}\nx${play.count} ${fireMultiplierToCost[play.fireMultiplier] ?? 0}火\n得分${play.score}\n获得PT ${play.pt}`,
                        maxWidth: 400,
                    }),
                ],
                maxWidth: width,
            }));
        }

        // 队伍组成
        const teamCards = await Promise.all(
            result.teamCardIds.map((id) => drawCardIconDefault(id, cardList?.[id]))
        );
        list.push(drawListTextWithImages({
            key: '队伍组成',
            content: teamCards,
            maxWidth: width,
        }));

        // 道具
        const itemsBlock = await drawItemsBlock(result.items ?? DEFAULT_ITEMS, width);
        list.push(...itemsBlock);

        all.push(drawDatablock({ list, topLeftText: `方案${i + 1}` }));
    }

    // 背景
    const BGimage = useEasyBG ? undefined : await event.getEventBGImage();

    const buffer = await outputFinalBuffer({
        imageList: all,
        useEasyBG,
        BGimage,
        text: '控分',
        compress,
    });

    return [buffer];
}
