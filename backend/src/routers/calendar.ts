import express from 'express';
import { body } from 'express-validator';
import { listToBase64 } from '@/routers/utils';
import { drawCalendar } from '@/view/calendar';
import { middleware } from '@/routers/middleware';
import { Request, Response } from 'express';

const router = express.Router();

router.post(
    '/',
    [
        body('year').optional().isInt({ min: 2015, max: 2100 }),
        body('month').optional().isInt({ min: 1, max: 12 }),
        body('compress').optional().isBoolean(),
    ],
    middleware,
    async (req: Request, res: Response) => {
        const { year, month, compress } = req.body;
        try {
            const result = await commandCalendar(year, month, compress);
            res.send(listToBase64(result));
        } catch (e) {
            res.status(500).send({ status: 'failed', data: '内部错误' });
        }
    }
);

/** 国服活动日历, year/month 缺省时为当前国服时间(UTC+8)的年月 */
export async function commandCalendar(year?: number, month?: number, compress: boolean = false): Promise<Array<Buffer | string>> {
    const nowCn = new Date(Date.now() + 8 * 3600000);
    const targetYear = year ?? nowCn.getUTCFullYear();
    const targetMonth = month ?? nowCn.getUTCMonth() + 1;
    return await drawCalendar(targetYear, targetMonth, compress);
}

export { router as calendarRouter }
