import { drawEventBorderPlayers } from '@/view/borderPlayers';
import { listToBase64 } from '@/routers/utils';
import express from 'express';
import { body } from 'express-validator';
import { middleware } from '@/routers/middleware';
import { Request, Response } from 'express';

const router = express.Router();

router.post('/',
    [
        body('eventId').optional().isInt(),
        body('useEasyBG').isBoolean(),
        body('compress').optional().isBoolean(),
    ],
    middleware,
    async (req: Request, res: Response) => {
        const { eventId, useEasyBG, compress } = req.body;
        try {
            const result = await drawEventBorderPlayers(eventId, useEasyBG, compress, 'event');
            res.send(listToBase64(result));
        } catch (e) {
            console.log(e);
            res.status(500).send({ status: 'failed', data: '内部错误' });
        }
    }
);

export { router as eventBorderPlayersRouter }
