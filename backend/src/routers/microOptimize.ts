import { Server } from "@/types/Server";
import { listToBase64 } from '@/routers/utils';
import { isServer } from "@/types/Server";
import { getServerByServerId } from "@/types/Server";
import axios from 'axios';
import { PlayerDB } from "@/database/playerDB";
import { playerDetail } from "@/types/BuildTypes";
import express from 'express';
import { body } from 'express-validator';
import { middleware } from '@/routers/middleware';
import { Request, Response } from 'express';
import { Event, getPresentEvent } from "@/types/Event";
import { drawMicroOptimize } from "@/view/microOptimize";
import { getDefaultSongs } from '@/routers/ptMaximize';
import { MicroApiEnvelope, MicroOptimizeData } from '@/types/MicroTypes';

const router = express.Router();
const playerDB = new PlayerDB(process.env.MONGODB_URI ?? 'mongodb://localhost:27017/', 'tsugu-bangdream-bot')

const optimizeBaseUrl = (process.env.BANGDREAM_OPTIMIZE_BASE_URL ?? 'http://127.0.0.1:3100').trim().replace(/\/+$/, '')

// /v1/micro-optimize (微操理论最高分)
const microOptimizeApiUrl = (() => {
    const endpoint = process.env.BANGDREAM_OPTIMIZE_MICRO_URL?.trim()
    if (endpoint) {
        return endpoint.replace(/\/+$/, '')
    }
    return `${optimizeBaseUrl}/v1/micro-optimize`
})();

// /v1/calc-result (取五卡队伍)
const calcResultApiUrl = (() => {
    const calcEndpoint = process.env.BANGDREAM_OPTIMIZE_CALC_URL?.trim()
    if (calcEndpoint) {
        return calcEndpoint.replace(/\/+$/, '')
    }
    return `${optimizeBaseUrl}/v1/calc-result`
})();

// calc-result 响应中用到的字段
interface CalcSongResult {
    songId: number;
    teamCardIds: number[];
}

type AreaStats = 'performance' | 'technique' | 'visual'

interface CalcResponseItems {
    band: string;
    attribute: string;
    magazine: AreaStats;
}

interface CalcResponse {
    eventId: number;
    songs: CalcSongResult[];
    items?: CalcResponseItems;
}

interface CalcApiEnvelope {
    status: 'ok' | 'error';
    data?: CalcResponse;
    message?: string;
}

// 统一的 optimize 服务请求封装 (错误 message 透传给用户)
async function postOptimize<T>(url: string, payload: object, timeoutMs: number): Promise<T> {
    let response;
    try {
        response = await axios.post<CalcApiEnvelope & MicroApiEnvelope>(url, payload, {
            timeout: timeoutMs,
            proxy: false, // 禁用系统代理，确保直连 127.0.0.1:3100
        });
    } catch (error) {
        if (axios.isAxiosError(error) && error.response) {
            const message = (error.response.data as Partial<CalcApiEnvelope & MicroApiEnvelope>)?.message;
            const status = error.response.status;
            throw new Error(message ? `${message}` : `计算服务返回 ${status}`);
        }
        throw error;
    }
    const body = response.data;
    if (body.status !== 'ok' || !body.data) {
        throw new Error(body.message ?? '计算服务返回异常');
    }
    return body.data as T;
}

function microOptimizeErrorMessage(error: unknown) {
    if (error instanceof Error) {
        return `错误: ${error.message}`
    }
    return '错误: 内部错误'
}

router.post('',
    [
        body('playerId').isInt(),
        body('mainServer').custom(isServer),
        body('compress').optional().isBoolean(),
    ],
    middleware,
    async (req: Request, res: Response) => {
        const { playerId, mainServer, compress } = req.body;

        try {
            const result = await commandMicroOptimize(playerId, getServerByServerId(mainServer), compress);
            res.send(listToBase64(result));
        } catch (e) {
            res.status(500).send({ status: 'failed', data: '内部错误' });
        }
    }
);


export async function commandMicroOptimize(playerId: number, mainServer: Server, compress: boolean, eventId?: number, difficultyOverride?: number): Promise<Array<Buffer | string>> {

    try {
        // 1. 获取玩家档案与活动
        const player: playerDetail = await playerDB.getPlayer(playerId)
        let currentEvent = eventId ?? player.currentEvent
        if (!currentEvent) {
            currentEvent = getPresentEvent(mainServer).eventId
        }
        const event = new Event(currentEvent)
        if (!event.isExist) {
            return [`错误：第${currentEvent}期活动不存在`]
        }
        await event.initFull()
        // 2. 微操计算仅支持 挑战/对邦 活动
        if (!['challenge', 'versus'].includes(event.eventType)) {
            return [`错误：微操计算仅支持 挑战(challenge)/对邦(versus) 类型活动, 当前是第${currentEvent}期活动（${event.getTypeName()}）; 切换活动请发送 组队计算 <活动ID>`]
        }

        // 3. 取歌: 「选择歌曲」优先, 其次活动默认曲 (同 PT计算 的取歌优先级)
        let songId: number
        let difficulty: number
        const selected = player.eventSongs?.[currentEvent]?.[0]
        if (selected) {
            songId = selected.songId
            difficulty = selected.difficulty
        } else {
            const defaults = getDefaultSongs(event, mainServer)
            if (!defaults || defaults.length === 0) {
                return ['错误：未设置选择歌曲, 且当前活动没有默认歌曲; 请先通过 组队计算 设置选择歌曲']
            }
            songId = defaults[0].songId
            difficulty = defaults[0].difficulty
        }
        if (difficultyOverride != undefined) {
            difficulty = difficultyOverride
        }

        // 4. 调用 calc-result 获取五卡队伍
        const calcData = await postOptimize<CalcResponse>(
            calcResultApiUrl,
            {
                playerId,
                server: Server[mainServer],
                eventId: currentEvent,
            },
            Number(process.env.BANGDREAM_OPTIMIZE_TIMEOUT_MS) || 300000 // 队伍计算超时 5 分钟
        )
        const teamEntry = calcData.songs?.find(s => s.songId === songId) ?? calcData.songs?.[0]
        const team = teamEntry?.teamCardIds
        if (!team || team.length !== 5) {
            return ['错误：计算服务未能返回五卡队伍']
        }

        // 5. 调用 micro-optimize 计算微操理论最高分
        const microData = await postOptimize<MicroOptimizeData>(
            microOptimizeApiUrl,
            {
                playerId,
                eventId: currentEvent,
                songId,
                difficulty,
                team,
            },
            Number(process.env.BANGDREAM_OPTIMIZE_TIMEOUT_MS) || 120000
        )

        // 6. 渲染
        const output = await drawMicroOptimize(microData, player, calcData.items, compress)
        return output
    }
    catch (e) {
        return [microOptimizeErrorMessage(e)]
    }
}

export { router as microOptimizeRouter }
