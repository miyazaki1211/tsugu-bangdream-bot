import { Server } from "@/types/Server";
import { listToBase64 } from '@/routers/utils';
import { isServer } from "@/types/Server";
import { getServerByServerId } from "@/types/Server";
import axios from 'axios';
import { PlayerDB } from "@/database/playerDB";
import express from 'express';
import { body } from 'express-validator';
import { middleware } from '@/routers/middleware';
import { Request, Response } from 'express';
import { getPresentEvent } from "@/types/Event";
import { perfMark } from '@/logger';
import { drawScoreRangeResult } from '@/view/scoreRange';
import { ScoreRangeResult, ApiEnvelope } from "@/types/PtTypes";

// ============================================================
//  对应 bangdream-optimize POST /v1/score-range 的控分搜索
//  参考: bangdream-optimize/docs/server-api.md
// ============================================================

const router = express.Router();
const playerDB = new PlayerDB(
    process.env.MONGODB_URI ?? 'mongodb://localhost:27017/',
    'tsugu-bangdream-bot'
);

const optimizeScoreRangeApiUrl = (() => {
    const baseUrl = (
        process.env.BANGDREAM_OPTIMIZE_BASE_URL ?? 'http://127.0.0.1:3100'
    )
        .trim()
        .replace(/\/+$/, '')
    return `${baseUrl}/v1/score-range`
})();

router.post(
    '',
    [
        body('playerId').isInt(),
        body('mainServer').custom(isServer),
        body('currentPt').isInt({ min: 0 }),
        body('targetTotalPt').isInt({ min: 0 }),
        body('supportStat').optional({ nullable: true }).isInt({ min: 0, max: 400000 }),
        body('useEasyBG').isBoolean(),
        body('compress').optional().isBoolean(),
    ],
    middleware,
    async (req: Request, res: Response) => {
        const { playerId, mainServer, currentPt, targetTotalPt, supportStat, useEasyBG, compress } = req.body;

        try {
            const result = await commandScoreRange(
                playerId,
                getServerByServerId(mainServer),
                useEasyBG,
                compress ?? true,
                currentPt,
                targetTotalPt,
                supportStat ?? null,
            );
            res.send(listToBase64(result));
        } catch (e) {
            console.log(e);
            const message = e instanceof Error ? e.message : '内部错误';
            res.status(500).send(listToBase64([message]));
        }
    }
);

export async function commandScoreRange(
    playerId: number,
    mainServer: Server,
    useEasyBG: boolean,
    compress: boolean,
    currentPt: number,
    targetTotalPt: number,
    supportStat: number | null,
): Promise<Array<Buffer | string>> {
    // 1. 活动固定为当前活动, 不接受外部指定活动
    const currentEvent = getPresentEvent(mainServer);
    if (!currentEvent || !currentEvent.isExist) {
        return ['无法确定当前活动'];
    }
    const eventId = currentEvent.eventId;
    const eventType = currentEvent.eventType;

    // 分差校验: 目标PT必须大于当前PT, 且分差不超过10w
    if (targetTotalPt <= currentPt) {
        return ['错误: 目标PT必须大于当前PT'];
    }
    if (targetTotalPt - currentPt > 100000) {
        return ['错误: 目标PT与当前PT的分差不能超过100000'];
    }

    // 2. 任务live必须传入支援队伍综合力 (missionSupportPtBonus = floor(支援队伍综合力 / 3000))
    let missionSupportPtBonus: number | undefined;
    if (eventType == 'mission_live') {
        if (supportStat == null) {
            return ['当前活动为任务live, 必须传入支援队伍综合力\n用法: 控分 <当前pt> <目标pt> <支援队伍综合力>'];
        }
        missionSupportPtBonus = Math.floor(supportStat / 3000);
    }

    // 3. 调用 optimize
    const perf = perfMark(`commandScoreRange e${eventId} ${Server[mainServer]}`)
    const reqBody: Record<string, unknown> = {
        playerId,
        server: Server[mainServer],
        eventId,
        currentPt,
        targetTotalPt,
        maxResults: 3,
    };
    if (missionSupportPtBonus !== undefined) {
        reqBody.missionSupportPtBonus = missionSupportPtBonus;
    }

    let response;
    try {
        response = await axios.post<ApiEnvelope<ScoreRangeResult[]>>(
            optimizeScoreRangeApiUrl,
            reqBody,
            {
                timeout: Number(process.env.BANGDREAM_OPTIMIZE_TIMEOUT_MS) || 120000,
                proxy: false,
            }
        );
    } catch (error) {
        if (axios.isAxiosError(error) && error.response) {
            const msg = (error.response.data as Partial<ApiEnvelope<never>>)
                ?.message;
            const status = error.response.status;
            return [msg ? `${status} ${msg}` : `计算服务返回 ${status}`];
        }
        throw error;
    }

    const body = response.data;
    if (body.status !== 'ok' || !body.data) {
        return [body.message ?? '计算服务返回异常'];
    }
    perf('计算服务请求');

    const results = body.data;
    if (results.length == 0) {
        return [`活动${eventId}: 未找到从 ${currentPt}PT 控分到 ${targetTotalPt}PT 的方案`];
    }

    // 4. 渲染
    try {
        const player = await playerDB.getPlayer(playerId);
        const buffers = await drawScoreRangeResult({
            eventId,
            results,
            currentPt,
            targetTotalPt,
            // 仅任务live显示支援综合力
            supportStat: eventType == 'mission_live' ? supportStat : null,
            useEasyBG,
            compress,
            player,
        });
        perf('结果渲染');
        return buffers;
    } catch (e) {
        console.error('scoreRange draw error:', e);
        return [
            '控分结果渲染失败: ' +
                (e instanceof Error ? e.message : String(e)),
        ];
    }
}

export { router as scoreRangeRouter };
