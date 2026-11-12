import { Event } from '@/types/Event';
import { drawList, drawListMerge, drawListTextWithImages, drawBandItemContent, drawAttributeItemContent } from '@/components/list';
import { drawDottedLine } from '@/image/dottedLine'
import { drawDatablock } from '@/components/dataBlock'
import { Canvas } from 'skia-canvas'
import { drawTitle } from '@/components/title'
import { outputFinalBuffer } from '@/image/output'
import { drawCardIcon } from '@/components/card'
import { Card } from '@/types/Card'
import { statConfig } from '@/components/list/stat'
import { drawText } from '@/image/text';
import { Song } from '@/types/Song';
import { drawSongInListMid } from '@/components/list/song';
import { PtMaximizeResult, SelectedAreaItems, PtMaximizeSingleTeam } from '@/types/PtTypes';
import { playerDetail } from '@/types/BuildTypes';

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

function formatAveragePt(
    averagePt: { ptSum: string; sampleCount: number },
): string {
    if (!averagePt || averagePt.sampleCount === 0) return '0';
    const sum = BigInt(averagePt.ptSum);
    const avg = Number(sum) / averagePt.sampleCount;
    return Math.round(avg * 15).toLocaleString();
}

async function drawSingleTeamBlock(
    team: PtMaximizeSingleTeam,
    titleLabel: string,
    cardList?: playerDetail['cardList'],
): Promise<{ list: Array<Canvas>; width: number }> {
    const width = 1020;
    const list: Array<Canvas> = [];
    const getCard = (id: number) => cardList?.[id];

    // 队伍 + 队长
    const capital = await drawCardIconDefault(team.captainCardId, getCard(team.captainCardId));
    const teamCards = await Promise.all(
        team.teamCardIds.map((id) => drawCardIconDefault(id, getCard(id)))
    );

    list.push(drawListTextWithImages({
        key: '队长',
        content: [capital],
    }));
    list.push(drawListTextWithImages({
        key: '队伍组成',
        content: teamCards,
        maxWidth: width,
    }));

    // 综合力 + PT 统计（只显示平均PT ×15）
    const statImage = drawList({ key: '综合力', text: `${team.totalStat}` });
    const avgPtText = formatAveragePt(team.evaluation.averagePt);
    const avgPtImage = drawList({ key: '平均PT（×15）', text: avgPtText });
    list.push(drawListMerge([statImage, avgPtImage], width));

    return { list, width };
}

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

async function drawPtMaximizeResult(
    data: PtMaximizeResult,
    eventId: number,
    useEasyBG: boolean,
    compress: boolean,
    opts?: { missionSupportPtBonus?: number; player?: playerDetail },
): Promise<Buffer[]> {
    const event = new Event(eventId);
    await event.initFull();
    const width = 1020;

    const line: Canvas = drawDottedLine({
        width,
        height: 30,
        startX: 5,
        startY: 15,
        endX: width - 5,
        endY: 15,
        radius: 2,
        gap: 10,
        color: '#a8a8a8',
    });

    const all: Array<Canvas> = [];

    // 标题
    all.push(drawTitle('PT', '计算'));

    // ── 协力配置 ──
    {
        const LIVE_VARIANT_NAMES: Record<string, string> = {
            solo: '单人',
            cooperative: '协力',
            versus: '对邦',
            festival: '5v5',
            medley: '组曲',
            challenge_cp: '挑战CP',
        };
        const configList: Array<Canvas> = [];
        const scenario = data.scenario;
        // 第一行: 模式
        configList.push(drawList({ key: '模式', text: LIVE_VARIANT_NAMES[data.liveVariant] ?? data.liveVariant }));

        // 第二行: 队友参数 (合并一行)
        if (scenario.cooperative) {
            const c = scenario.cooperative;
            const t = Array.isArray(c.teammates) ? c.teammates[0] : c.teammates;
            configList.push(drawListMerge([
                drawList({ key: '队友综合力', text: `${t.expectedStat.toLocaleString()}` }),
                drawList({ key: '队长技能倍率', text: `${Math.round(t.leaderScoreUp * 100)}%` }),
                drawList({ key: '技能时长', text: `${t.leaderSkillDuration}s` }),
            ], width));
        }
        // 对邦 / FES 模式
        if (scenario.versus) {
            configList.push(drawList({ key: '对邦排名', text: `第${scenario.versus.teamRank + 1}名` }));
        }
        if (scenario.festival) {
            configList.push(drawListMerge([
                drawList({ key: 'FES排名', text: `第${scenario.festival.teamRank + 1}名` }),
                drawList({ key: '胜负', text: scenario.festival.won ? '胜' : '负' }),
            ], width));
        }
        all.push(drawDatablock({ list: configList }));
    }

    // ── 活动数据 (所有单人打歌活动类型) ──
    if (
        (data.eventType === 'mission_live' || data.eventType === 'live_try' ||
         data.eventType === 'challenge' || data.eventType === 'versus' ||
         data.eventType === 'festival') &&
        data.team
    ) {
        const bonusList: Array<Canvas> = [];

        // 活动pt加成 — 5种加成逐卡计算
        const teamCardIds = data.team.teamCardIds;
        const combinedPercent = event.eventAttributeAndCharacterBonus?.pointPercent ?? 0;
        const cardList = opts?.player?.cardList;
        let totalBonus = 0;

        for (const cardId of teamCardIds) {
            const card = new Card(cardId);
            const cardConfig = cardList?.[cardId];
            const limitBreakRank = cardConfig?.limitBreakRank ?? 0;
            let attrMatch = false;
            let charMatch = false;
            let cardTotal = 0;

            for (const attr of event.attributes || []) {
                if (attr.attribute === card.attribute) {
                    cardTotal += attr.percent;
                    attrMatch = true;
                }
            }
            for (const ch of event.characters || []) {
                if (ch.characterId === card.characterId) {
                    cardTotal += ch.percent;
                    charMatch = true;
                }
            }
            if (attrMatch && charMatch && combinedPercent !== 0) {
                cardTotal += combinedPercent;
            }
            for (const m of event.members || []) {
                if (m.situationId === cardId) {
                    cardTotal += m.percent;
                }
            }
            if (event.limitBreaks?.[card.rarity]?.[limitBreakRank] != null) {
                cardTotal += event.limitBreaks[card.rarity][limitBreakRank];
            }
            totalBonus += cardTotal;
        }

        // 第一行: 活动pt加成 + 支援乐队综合力
        const row1Items: Array<Canvas> = [
            drawList({ key: '活动pt加成', text: `+${Math.round(totalBonus)}%` }),
        ];
        if (data.eventType === 'mission_live' && opts?.missionSupportPtBonus) {
            row1Items.push(drawList({
                key: '支援综合力',
                text: `${(opts.missionSupportPtBonus * 3000).toLocaleString()}`,
            }));
        }
        bonusList.push(drawListMerge(row1Items, width));

        // 第二行: 自身演出分数 + 房间总分数
        const sd = data.team.evaluation.scoreDistribution;
        if (sd && sd.sampleCount > 0) {
            const avgScore = Math.round(sd.scoreSum / sd.sampleCount);
            const row2Items: Array<Canvas> = [];
            if (data.liveVariant === 'versus' || data.liveVariant === 'festival') {
                // 对邦/5v5: 队友随机, 自身演出分数按采样分布展示为 最小值 ~ 最大值 区间
                const hasRange = sd.maxScore > 0 && sd.maxScore >= sd.minScore;
                const minScore = hasRange ? Math.round(sd.minScore) : avgScore;
                const maxScore = hasRange ? Math.round(sd.maxScore) : avgScore;
                row2Items.push(drawList({
                    key: '自身演出分数',
                    text: `${minScore.toLocaleString()} ~ ${maxScore.toLocaleString()}`,
                }));
            } else {
                row2Items.push(drawList({ key: '自身演出分数', text: avgScore.toLocaleString() }));
            }
            if (data.liveVariant === 'cooperative' && data.scenario.cooperative) {
                const c = data.scenario.cooperative;
                const t = Array.isArray(c.teammates) ? c.teammates[0] : c.teammates;
                const totalStat = data.team.totalStat;
                const roomEstimate = Math.round(
                    avgScore * (totalStat + t.expectedStat * 4) / totalStat
                );
                row2Items.push(drawList({
                    key: '房间总分数',
                    text: roomEstimate.toLocaleString(),
                }));
            }
            bonusList.push(drawListMerge(row2Items, width));
        }

        all.push(drawDatablock({ list: bonusList }));
    }

    // ── 当前歌曲 (一行: 封面+难度图标 + 名称) ──
    if (data.songs && data.songs.length > 0) {
        const s = data.songs[0];
        const song = new Song(s.songId);
        const songTitle = song.musicTitle?.[0] ?? `ID:${s.songId}`;

        all.push(drawDatablock({
            list: [drawListTextWithImages({
                key: '歌曲',
                content: [
                    await drawSongInListMid(song, s.difficulty),
                    drawText({ text: songTitle, maxWidth: 400 }),
                ],
                maxWidth: width,
            })],
        }));
    }

    // ── 队伍 ──
    if (data.team) {
        const block = await drawSingleTeamBlock(data.team, '', opts?.player?.cardList);
        all.push(drawDatablock(block));

        // ── 道具 ──
        const items = data.team.items ?? DEFAULT_ITEMS;
        const itemsBlock = await drawItemsBlock(items, width, line);
        all.push(drawDatablock({ list: itemsBlock }));
    }

    // medley: 多首歌
    if (data.medley) {
        for (let i = 0; i < data.medley.teams.length; i++) {
            const t = data.medley.teams[i];

            // 构造一个兼容的 single team 结构用于渲染
            const singleLike: PtMaximizeSingleTeam = {
                teamCardIds: t.teamCardIds,
                captainCardId: t.captainCardId,
                totalStat: t.totalStat,
                items: t.items,
                evaluation: {
                    eventType: data.eventType,
                    liveVariant: data.liveVariant,
                    captainIndex: 0,
                    captainCardId: t.captainCardId,
                    scoreDistribution: t.scoreDistribution ?? {
                        entries: [],
                        scoreSum: 0,
                        minScore: 0,
                        maxScore: 0,
                        sampleCount: 0,
                    },
                    averagePt: { ptSum: '0', sampleCount: 1 },
                    minPt: 0,
                    maxPt: 0,
                },
            };

            const block = await drawSingleTeamBlock(singleLike, `第${i + 1}首`, opts?.player?.cardList);
            all.push(drawDatablock(block));

            // 每首歌的道具
            if (t.items) {
                const itemsBlock = await drawItemsBlock(t.items, width, line);
                all.push(drawDatablock({ list: itemsBlock }));
            }
        }

        // medley 汇总 - 仅显示平均PT ×15
        const summaryList: Array<Canvas> = [];
        const avgPt = formatAveragePt(data.medley.averagePt);
        summaryList.push(drawList({ key: '平均PT（×15）', text: avgPt }));
        all.push(drawDatablock({ list: summaryList }));
    }

    // 背景
    const BGimage = useEasyBG ? undefined : await event.getEventBGImage();

    const buffer = await outputFinalBuffer({
        imageList: all,
        useEasyBG,
        BGimage,
        text: 'PT',
        compress,
    });

    return [buffer];
}

async function drawItemsBlock(
    items: SelectedAreaItems,
    width: number,
    line: Canvas,
): Promise<Array<Canvas>> {
    const list: Array<Canvas> = [];

    const bandId = items.band;
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
    const magazineItemImage = drawList({
        key: '杂志道具',
        text: statConfig[magazine]?.name ?? magazine,
        lineSpacing: 40,
    });

    list.push(drawListMerge([bandItemImage, attributeItemImage, magazineItemImage], width));

    return list;
}

export { drawPtMaximizeResult };
