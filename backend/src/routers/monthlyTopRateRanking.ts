import { Server, getServerByServerId, isServer } from '@/types/Server';
import { getPresentMonthlyRanking } from '@/types/MonthlyRanking';
import { serverNameFullList } from '@/config';
import { listToBase64 } from '@/routers/utils';
import { body } from 'express-validator';
import express from 'express';
import { drawMonthlyRankingTopRateRanking } from '@/view/monthlyRankingCutoffEventTop';
import { middleware } from '@/routers/middleware';
import { Request, Response } from 'express';

const router = express.Router();

router.post(
    '/',
    [
        body('mainServer').custom(isServer),
        body('monthlyRankingId').optional().isInt(),
        body('length').optional().isInt(),
        body('date').optional().isInt(),
        body('compareTier').optional().isInt(),
        body('compareUid').optional().isInt(),
        body('compress').optional().isBoolean(),
    ],
    middleware,
    async (req: Request, res: Response) => {

        const { mainServer, monthlyRankingId, length, date, compareTier, compareUid, compress } = req.body;

        try {
            const result = await commandMonthlyTopRateRanking(getServerByServerId(mainServer), compress, monthlyRankingId, length, date ? new Date(date) : undefined, compareTier, compareUid);
            res.send(listToBase64(result));
        } catch (e) {
            console.log(e);
            res.status(500).send({ status: 'failed', data: '内部错误' });
        }
    }
);

export async function commandMonthlyTopRateRanking(mainServer: Server, compress: boolean, monthlyRankingId: number, length = 60, date: Date, compareTier?: number, comparePlayerUid?: number): Promise<Array<Buffer | string>> {
    if (!monthlyRankingId) {
        const presentMonthlyRanking = getPresentMonthlyRanking(mainServer, date ? +date : undefined);
        if (!presentMonthlyRanking) {
            return [`错误: ${serverNameFullList[mainServer]} 当前没有可用月榜`];
        }
        monthlyRankingId = presentMonthlyRanking.monthlyRankingId;
    }
    return await drawMonthlyRankingTopRateRanking(monthlyRankingId, mainServer, compress, length, date, compareTier, comparePlayerUid);
}

export { router as monthlyTopRateRankingRouter };
