import express from 'express';
import { body, validationResult } from 'express-validator';
import { drawCardDetail } from '@/view/cardDetail';
import { drawCardList } from '@/view/cardList';
import { isInteger, listToBase64 } from '@/routers/utils';
import { isServerList } from '@/types/Server';
import { fuzzySearch, FuzzySearchResult, isFuzzySearchResult } from '@/fuzzySearch';
import { getServerByServerId, isServer, Server } from '@/types/Server';
import { middleware } from '@/routers/middleware';
import { Request, Response } from 'express';

const router = express.Router();

router.post(
    '/',
    [
        body('displayedServerList').custom(isServerList),
        body('text').optional().isString(),
        body('fuzzySearchResult').optional().custom(isFuzzySearchResult),
        body('useEasyBG').isBoolean(),
        body('compress').optional().isBoolean(),
        body('playerId').optional().isInt(),
        body('playerServer').optional().custom(isServer),
    ],
    middleware,
    async (req: Request, res: Response) => {
        const { displayedServerList, text, fuzzySearchResult, useEasyBG, compress, playerId, playerServer } = req.body;
        
        // 检查 text 和 fuzzySearchResult 是否同时存在
        if (text && fuzzySearchResult) {
            return res.status(422).json({ status: 'failed', data: 'text 与 fuzzySearchResult 不能同时存在' });
        }
        // 检查 text 和 fuzzySearchResult 是否同时不存在
        if (!text && !fuzzySearchResult) {
            return res.status(422).json({ status: 'failed', data: '不能同时不存在 text 与 fuzzySearchResult' });
        }

        try {
            //绑定的玩家信息(可选)，仅用于卡牌列表渲染时标记已拥有的卡牌
            const playerInfo = (playerId != undefined && playerServer != undefined)
                ? { playerId: playerId, server: getServerByServerId(playerServer) }
                : undefined;
            const result = await commandCard(displayedServerList, text || fuzzySearchResult, useEasyBG, compress, playerInfo);
            res.send(listToBase64(result));
        } catch (e) {
            console.log(e);
            res.status(500).send({ status: 'failed', data: '内部错误' });
        }
    }
);

async function commandCard(displayedServerList: Server[], input: string | FuzzySearchResult, useEasyBG: boolean, compress?: boolean, playerInfo?: { playerId: number, server: Server }) {
    let fuzzySearchResult: FuzzySearchResult
    // 根据 input 的类型执行不同的逻辑
    if (typeof input === 'string') {
        if (isInteger(input)) {
            return await drawCardDetail(parseInt(input), displayedServerList, useEasyBG, compress)
        }
        fuzzySearchResult = fuzzySearch(input)
    } else {
        // 使用 fuzzySearch 逻辑
        fuzzySearchResult = input
    }
    if (Object.keys(fuzzySearchResult).length == 0) {
        return ['错误: 没有有效的关键词']
    }

    return await drawCardList(fuzzySearchResult, displayedServerList, useEasyBG, compress, playerInfo)

}

export { router as searchCardRouter }