import { Card } from "@/types/Card";
import { Character } from "@/types/Character";
import mainAPI from "@/types/_Main"
import { getPresentEvent } from "@/types/Event";
import { drawCardDetail } from '@/view/cardDetail';
import { PlayerDB } from '@/database/playerDB';
import { match, checkRelationList, FuzzySearchResult } from "@/fuzzySearch"
import { Canvas } from 'skia-canvas'
import { drawCardIcon } from "@/components/card"
import { drawDatablockHorizontal } from '@/components/dataBlock';
import { stackImage } from '@/components/utils'
import { drawTitle } from '@/components/title';
import { outputFinalBuffer } from '@/image/output'
import { Server } from '@/types/Server'
import { globalDefaultServer } from '@/config';

const maxWidth = 7000

export async function drawCardList(matches: FuzzySearchResult, displayedServerList: Server[] = globalDefaultServer, useEasyBG: boolean, compress: boolean, playerInfo?: { playerId: number, server: Server }): Promise<Array<Buffer | string>> {

    //计算模糊搜索结果
    const tempCardList: Array<Card> = matchCardList(matches, displayedServerList);

    if (tempCardList.length == 0) {
        return ['没有搜索到符合条件的卡牌']
    }
    if (tempCardList.length == 1) {
        return await drawCardDetail(tempCardList[0].cardId, displayedServerList, useEasyBG, compress)
    }

    //若提供了绑定玩家信息，获取该玩家已导入的卡牌数据，用于在列表中标记已拥有的卡牌并渲染星光等级/技能等级
    const ownedCardMap = await getPlayerOwnedCardMap(playerInfo);
    //获取国服当前活动卡牌的最大卡牌ID，作为日服限定卡红/灰标记的分界阈值
    const cnCurrentEventMaxCardId = getCnCurrentEventMaxCardId();

    //计算表格，X轴为颜色，Y轴为角色
    var characterIdList: number[] = [];
    var attributeList: Array<'cool' | 'happy' | 'pure' | 'powerful'> = [];
    for (let i = 0; i < tempCardList.length; i++) {
        const tempCard = tempCardList[i];
        if (!characterIdList.includes(tempCard.characterId)) {
            characterIdList.push(tempCard.characterId);
        }
        if (!attributeList.includes(tempCard.attribute)) {
            attributeList.push(tempCard.attribute);
        }
    }
    var cardListImage: Canvas;
    var characterIconImageList: Canvas[] = [];//角色头像列表，画在最左边
    //画角色头像Icon函数
    async function drawCharacterIcon(characterId: number | null): Promise<Canvas> {
        const tempCanvas = new Canvas(100, 140);
        const ctx = tempCanvas.getContext('2d');
        if (characterId == null) {
            return tempCanvas;
        }
        const character = new Character(characterId);
        const characterIcon = await character.getIcon();
        ctx.drawImage(characterIcon, 0, 25, 75, 75);
        return tempCanvas;
    }
    characterIdList.sort((a, b) => {
        return a - b;
    })
    //如果角色数量大于5，则颜色作为X轴，角色作为Y轴
    if (characterIdList.length > 5) {
        let promise = []
        var tempAttributeImageList: Canvas[] = []//每一个颜色的所有角色的列
        for (let i = 0; i < attributeList.length; i++) {
            const attribute = attributeList[i];
            var tempAttributeCardImageList: Canvas[] = []//这个颜色的所有角色的行
            for (let j = 0; j < characterIdList.length; j++) {
                const characterId = characterIdList[j];
                var tempAttributeCardList = getCardListByAttributeAndCharacterId(tempCardList, attribute, characterId);
                promise.push(tempAttributeCardImageList.push(await drawCardListLine(tempAttributeCardList, ownedCardMap, cnCurrentEventMaxCardId)));
                //画角色头像
                if (i == 0) {
                    promise.push(characterIconImageList.push(await drawCharacterIcon(characterId)));
                }
            }
            tempAttributeImageList.push(stackImage(
                tempAttributeCardImageList
            ));

        }
        await Promise.all(promise)
        const characterIconImage = stackImage(characterIconImageList);
        tempAttributeImageList.unshift(characterIconImage);
        cardListImage = drawDatablockHorizontal({
            list: tempAttributeImageList,
        })
        if (cardListImage.width > maxWidth) {
            let times = 0
            let tempImageList: Array<Buffer | string> = []
            tempImageList.push('卡牌列表过长，已经拆分输出')
            for (let i = 0; i < tempAttributeImageList.length; i++) {

                const tempCanv = tempAttributeImageList[i];
                if (tempCanv == characterIconImage) {
                    continue
                }
                const all = []
                all.push(drawDatablockHorizontal({ list: [characterIconImage, tempCanv] }))
                const buffer = await outputFinalBuffer({
                    imageList: all,
                    useEasyBG: true
                })
                tempImageList.push(buffer)
                times += 1
            }
            return tempImageList
        }
        var all = []
        all.push(drawTitle('查询', '卡牌列表'))
        all.push(cardListImage)
        var buffer = await outputFinalBuffer({
            imageList: all,
            useEasyBG: true,
            compress: compress,
        })
        return [buffer]
    }
    else {
        var tempCardImageList: Canvas[] = []//总列
        let promise = []
        for (let i = 0; i < characterIdList.length; i++) {
            const characterId = characterIdList[i];
            let icon = true
            for (let j = 0; j < attributeList.length; j++) {
                const attribute = attributeList[j];
                var tempAttributeCardList = getCardListByAttributeAndCharacterId(tempCardList, attribute, characterId);
                if (tempAttributeCardList.length != 0) {
                    promise.push(tempCardImageList.push(await drawCardListLine(tempAttributeCardList, ownedCardMap, cnCurrentEventMaxCardId)));
                    //画角色头像
                    if (icon) {
                        promise.push(characterIconImageList.push(await drawCharacterIcon(characterId)));
                        icon = false
                    }
                    else {
                        promise.push(characterIconImageList.push(await drawCharacterIcon(null)));
                    }
                }
            }
        }
        await Promise.all(promise)
        const cardListImageWithoutCharacterIcon = await stackImage(
            tempCardImageList,
        )
        var characterIconImage = stackImage(characterIconImageList);
        cardListImage = drawDatablockHorizontal({ list: [characterIconImage, cardListImageWithoutCharacterIcon] });
        var all = []
        all.push(drawTitle('查询', '卡牌列表'))
        all.push(cardListImage)
        var buffer = await outputFinalBuffer({
            imageList: all,
            useEasyBG: true,
            compress: compress
        })
        return [buffer]
    }
}

//计算模糊搜索结果
export function matchCardList(matches: FuzzySearchResult, displayedServerList: Server[]) {
    var tempCardList: Array<Card> = [];//最终输出的卡牌列表
    var cardIdList: Array<number> = Object.keys(mainAPI['cards']).map(Number);//所有卡牌ID列表
    for (let i = 0; i < cardIdList.length; i++) {
        const tempCard = new Card(cardIdList[i]);
        if (tempCard.type == 'others') {
            continue;
        }
        var isMatch = match(matches, tempCard, ['cardId']);
        //如果在所有所选服务器列表中都不存在，则不输出
        var numberOfReleasedServer = 0;
        for (var j = 0; j < displayedServerList.length; j++) {
            var server = displayedServerList[j];
            if (tempCard.releasedAt[server] != null) {
                numberOfReleasedServer++;
            }
        }
        if (numberOfReleasedServer == 0) {
            isMatch = false;
        }

        //如果有数字关系词，则判断关系词

        if (matches._relationStr != undefined) {
            //如果之后范围的话则直接判断
            if (isMatch || Object.keys(matches).length == 1) {
                isMatch = checkRelationList(tempCard.cardId, matches._relationStr as string[])
            }
        }

        if (isMatch) {
            tempCardList.push(tempCard);
        }
    }
    return tempCardList;
}

function getCardListByAttributeAndCharacterId(cardFullList: Card[], attribute: 'cool' | 'happy' | 'pure' | 'powerful', characterId: number) {
    var cardList: Card[] = [];
    for (let i = 0; i < cardFullList.length; i++) {
        const tempCard = cardFullList[i];
        if (tempCard.attribute == attribute && tempCard.characterId == characterId) {
            cardList.push(tempCard);
        }
    }
    return cardList;
}

//玩家已导入的卡牌数据条目 (players 集合 cardList 的值结构)
type OwnedCardInfo = { illustTrainingStatus: boolean, limitBreakRank: number, skillLevel: number }

//玩家已导入的卡牌数据库(players 集合), 存有玩家导入的全量卡牌数据 cardList
const playerDB = new PlayerDB(
    process.env.MONGODB_URI ?? 'mongodb://localhost:27017/',
    process.env.MONGODB_DATABASE_NAME ?? 'tsugu-bangdream-bot'
);

//获取玩家已导入的卡牌数据(卡牌ID → 星光等级/技能等级等)，
//未提供玩家信息、玩家未导入卡牌数据或查询失败时返回空Map(不显示绿色标记与等级渲染)
async function getPlayerOwnedCardMap(playerInfo?: { playerId: number, server: Server }): Promise<Map<number, OwnedCardInfo>> {
    const ownedCardMap = new Map<number, OwnedCardInfo>();
    if (playerInfo == undefined) {
        return ownedCardMap;
    }
    try {
        const player = await playerDB.findPlayer(playerInfo.playerId);
        if (player == null) {
            return ownedCardMap;
        }
        const cardListEntries = Object.entries(player.cardList ?? {}) as Array<[string, OwnedCardInfo]>;
        for (const [cardId, card] of cardListEntries) {
            ownedCardMap.set(Number(cardId), card);
        }
    }
    catch (e) {
        //获取玩家卡牌数据失败时不影响卡牌列表的正常渲染
        console.log(e);
    }
    return ownedCardMap;
}

//获取国服当前活动卡牌的最大卡牌ID，无法确定时返回 NaN (此时不进行日服限定红/灰标记)
function getCnCurrentEventMaxCardId(): number {
    const currentEvent = getPresentEvent(Server.cn);
    if (currentEvent == null || currentEvent.rewardCards.length == 0) {
        return NaN;
    }
    return Math.max(...currentEvent.rewardCards);
}

//每个颜色和角色的一行
async function drawCardListLine(cardList: Card[], ownedCardMap: Map<number, OwnedCardInfo>, cnCurrentEventMaxCardId: number) {
    if (cardList.length == 0) {
        return new Canvas(1, 140);
    }
    const maxX = cardList.length * 140
    const maxY = 140
    const canvas = new Canvas(maxX, maxY)
    const ctx = canvas.getContext('2d')
    //排序，稀有度高的在前面，其中技能加成高的在前面
    cardList.sort((a, b) => {
        if (a.rarity > b.rarity) {
            return -1;
        } else if (a.rarity < b.rarity) {
            return 1;
        } else {
            if (a.scoreUpMaxValue > b.scoreUpMaxValue) {
                return -1;
            } else if (a.scoreUpMaxValue < b.scoreUpMaxValue) {
                return 1;
            } else {
                return 0;
            }
        }
    });
    //画卡牌，从左到右，宽度120，间隔20
    for (let i = 0; i < cardList.length; i++) {
        const tempCard = cardList[i];
        const ownedCard = ownedCardMap.get(tempCard.cardId);
        //已拥有的卡牌渲染玩家导入的星光等级与技能等级 (技能等级角标会替换默认的卡牌类型角标位置)
        const cardIcon = await drawCardIcon({
            card: tempCard,
            trainingStatus: true,
            cardIdVisible: true,
            skillTypeVisible: true,
            limitBreakRank: ownedCard?.limitBreakRank ?? 0,
            skillLevel: ownedCard?.skillLevel
        })
        var ratio = 120 / cardIcon.width
        ctx.drawImage(cardIcon, i * 140, 0, cardIcon.width * ratio, cardIcon.height * ratio)
        //在卡牌ID右侧绘制圆形标记(与卡牌右侧对齐)，标记颜色判定与是否绑定玩家无关:
        //日服限定卡(运行时判定: 日服已发布且国服未发布): 卡牌ID小于国服当前活动卡牌最大ID → 红色(国服已错过, 大概率不会再上), 大于 → 灰色(国服尚未追上, 之后会出)
        //其余卡牌: 仅当玩家已绑定且账号内导入了卡牌数据时, 已拥有 → 绿色
        let markerColor: string | null = null
        const isJpOnlyCard = tempCard.releasedAt[Server.jp] != null && tempCard.releasedAt[Server.cn] == null
        if (isJpOnlyCard) {
            if (!Number.isNaN(cnCurrentEventMaxCardId)) {
                markerColor = tempCard.cardId < cnCurrentEventMaxCardId ? '#e53935' : '#9e9e9e'
            }
        }
        else if (ownedCard != undefined) {
            markerColor = '#44C527'
        }
        if (markerColor != null) {
            ctx.fillStyle = markerColor;
            ctx.beginPath();
            ctx.arc(i * 140 + 107, 130, 10, 0, Math.PI * 2);
            ctx.fill();
            ctx.lineWidth = 2;
            ctx.strokeStyle = '#ffffff';
            ctx.stroke();
        }
    }
    return canvas
}
