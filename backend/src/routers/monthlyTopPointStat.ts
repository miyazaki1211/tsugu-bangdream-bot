import { Server, getServerByServerId, isServer } from '@/types/Server';
import { getPresentMonthlyRanking } from '@/types/MonthlyRanking';
import { serverNameFullList } from '@/config';
import { listToBase64 } from '@/routers/utils';
import { body } from 'express-validator';
import express from 'express';
import { drawMonthlyRankingTopPointStat } from '@/view/monthlyRankingCutoffEventTop';
import { middleware } from '@/routers/middleware';
import { Request, Response } from 'express';

const router = express.Router();

router.post(
    '/',
    [
        body('mainServer').custom(isServer),
        body('monthlyRankingId').optional().isInt(),
        body('playerId').optional().isInt(),
        body('tier').optional().isInt(),
        body('limit').optional().isString(),
        body('compress').optional().isBoolean(),
    ],
    middleware,
    async (req: Request, res: Response) => {

        const { mainServer, monthlyRankingId, playerId, tier, limit, compress } = req.body;

        try {
            const result = await commandMonthlyTopPointStat(getServerByServerId(mainServer), monthlyRankingId, playerId, tier, compress, limit);
            res.send(listToBase64(result));
        } catch (e) {
            console.log(e);
            res.status(500).send({ status: 'failed', data: '内部错误' });
        }
    }
);

export async function commandMonthlyTopPointStat(mainServer: Server, monthlyRankingId: number, playerId: number, tier: number, compress: boolean, limit: string): Promise<Array<Buffer | string>> {
    if (!playerId && !tier) {
        return ['请输入玩家id或排名']
    }
    if (!monthlyRankingId) {
        const presentMonthlyRanking = getPresentMonthlyRanking(mainServer)
        if (!presentMonthlyRanking) {
            return [`错误: ${serverNameFullList[mainServer]} 当前没有可用月榜`];
        }
        monthlyRankingId = presentMonthlyRanking.monthlyRankingId
    }
    return await drawMonthlyRankingTopPointStat(monthlyRankingId, playerId, tier, limit, mainServer, compress)
}

export { router as monthlyTopPointStatRouter }
