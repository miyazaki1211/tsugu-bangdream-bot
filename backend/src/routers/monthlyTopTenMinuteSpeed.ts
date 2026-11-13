import { Server, getServerByServerId, isServer } from '@/types/Server';
import { getPresentMonthlyRanking } from '@/types/MonthlyRanking';
import { serverNameFullList } from '@/config';
import { listToBase64 } from '@/routers/utils';
import { body } from 'express-validator';
import express from 'express';
import { drawMonthlyRankingTopTenMinuteSpeed } from '@/view/monthlyRankingCutoffEventTop';
import { middleware } from '@/routers/middleware';
import { Request, Response } from 'express';

const router = express.Router();

router.post(
    '/',
    [
        body('mainServer').custom(isServer),
        body('monthlyRankingId').optional().isInt(),
        body('compress').optional().isBoolean(),
        body('allPlayer').optional().isBoolean(),
        body('time').optional().isInt(),
        body('date').optional().isInt(),
    ],
    middleware,
    async (req: Request, res: Response) => {

        const { mainServer, monthlyRankingId, compress, time, date, allPlayer } = req.body;

        try {
            const result = await commandMonthlyTopTenMinuteSpeed(getServerByServerId(mainServer), compress, monthlyRankingId, date ? new Date(date) : undefined, time, allPlayer);
            res.send(listToBase64(result));
        } catch (e) {
            console.log(e);
            res.status(500).send({ status: 'failed', data: '内部错误' });
        }
    }
);

export async function commandMonthlyTopTenMinuteSpeed(mainServer: Server, compress: boolean, monthlyRankingId: number, date: Date, time?: number, allPlayer?: boolean): Promise<Array<Buffer | string>> {
    if (!monthlyRankingId) {
        const presentMonthlyRanking = getPresentMonthlyRanking(mainServer, date ? +date : undefined);
        if (!presentMonthlyRanking) {
            return [`错误: ${serverNameFullList[mainServer]} 当前没有可用月榜`];
        }
        monthlyRankingId = presentMonthlyRanking.monthlyRankingId;
    }
    return await drawMonthlyRankingTopTenMinuteSpeed(monthlyRankingId, mainServer, compress, date, time, allPlayer);
}

export { router as monthlyTopTenMinuteSpeedRouter };
