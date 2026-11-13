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
import { Event } from "@/types/Event";
import { drawPtMaximizeResult } from "@/view/ptMaximize";
import { PtConfig, DEFAULT_PT_CONFIG, DEFAULT_PT_SONG } from "@/types/BuildTypes";
import { Song } from "@/types/Song";
import { perfMark } from '@/logger';
import {
    PtMaximizeResult,
    ApiEnvelope,
    SongSelection,
    LiveVariant,
    CooperativeTeammate,
    CooperativeInput,
    CooperativeLeaderSelection,
    VersusInput,
    FestivalInput,
} from "@/types/PtTypes";

const router = express.Router();
const playerDB = new PlayerDB(
    process.env.MONGODB_URI ?? 'mongodb://localhost:27017/',
    'tsugu-bangdream-bot'
);

const optimizeCalcApiUrl = (() => {
    const calcEndpoint = process.env.BANGDREAM_OPTIMIZE_CALC_URL?.trim()
    if (calcEndpoint) {
        return calcEndpoint.replace(/\/+$/, '')
    }
    const baseUrl = (
        process.env.BANGDREAM_OPTIMIZE_BASE_URL ?? 'http://127.0.0.1:3100'
    )
        .trim()
        .replace(/\/+$/, '')
    return `${baseUrl}/v1/pt-maximize`
})();

// ============================================================
//  .env 默认配置读取
// ============================================================

const PT_DEFAULTS = {
    leaderSelection:
        process.env.PT_DEFAULT_LEADER_SELECTION?.trim() || 'max_stat',
    minimumPersonalStat: Number(process.env.PT_DEFAULT_MINIMUM_PERSONAL_STAT) || 0,
} as const;

// ============================================================
//  eventType → 支持的 liveVariant 兼容矩阵 + 默认选择
//  参考: API 文档第 66-76 行兼容矩阵
// ============================================================

const EVENT_LIVE_MATRIX: Record<
    string,
    { supported: LiveVariant[]; defaultVariant: LiveVariant }
> = {
    mission_live: { supported: ['solo', 'cooperative'], defaultVariant: 'cooperative' },
    live_try:     { supported: ['solo', 'cooperative'], defaultVariant: 'cooperative' },
    challenge:    { supported: ['solo', 'cooperative', 'challenge_cp'], defaultVariant: 'cooperative' },
    versus:       { supported: ['solo', 'versus'], defaultVariant: 'versus' },
    festival:     { supported: ['solo', 'festival'], defaultVariant: 'festival' },
    medley:       { supported: ['medley'], defaultVariant: 'medley' },
};

function resolveLiveVariant(
    eventType: string,
    userVariant?: string | null,
): LiveVariant {
    const matrix = EVENT_LIVE_MATRIX[eventType];
    if (!matrix) {
        return 'solo';
    }
    if (userVariant) {
        if (matrix.supported.includes(userVariant as LiveVariant)) {
            return userVariant as LiveVariant;
        }
        throw new Error(
            `活动类型 ${eventType} 不支持 liveVariant=${userVariant}，可选: ${matrix.supported.join(', ')}; 切换活动请发送 组队计算 <活动ID>`
        );
    }
    return matrix.defaultVariant;
}

function resolveLeaderSelection(): CooperativeLeaderSelection {
    if (PT_DEFAULTS.leaderSelection === 'random') {
        return { mode: 'random' };
    } else if (PT_DEFAULTS.leaderSelection.startsWith('specified:')) {
        return { mode: 'specified', playerIndex: Number(PT_DEFAULTS.leaderSelection.split(':')[1]) || 0 };
    }
    return { mode: 'max_stat' };
}

function buildCooperativeInput(pt: PtConfig): CooperativeInput {
    return {
        teammates: {
            expectedStat: pt.teammateStat,
            leaderScoreUp: pt.leaderScoreUpRaw / 100,
            leaderSkillDuration: pt.leaderSkillDuration,
        },
        leaderSelection: resolveLeaderSelection(),
    };
}

function buildVersusInput(pt: PtConfig): VersusInput {
    return { teamRank: pt.teamRankInput - 1 };
}

function buildFestivalInput(pt: PtConfig): FestivalInput {
    return {
        teammateScores: 0,
        teamRank: pt.teamRankInput - 1,
        won: pt.festivalWon,
    };
}

/** 从活动数据中提取默认歌曲列表 (musics 按服务器索引) */
export function getDefaultSongs(event: Event, server: Server): SongSelection[] {
    const serverMusics = event.musics?.[server]?.length
        ? event.musics[server]
        : event.musics?.find((m) => m && m.length > 0)
    const songs: SongSelection[] = [];
    for (const element of serverMusics ?? []) {
        if (!element) continue
        const song = new Song(element.musicId)
        songs.push({ songId: song.songId, difficulty: song.getMaxMetaDiffId() })
    }
    return songs;
}

router.post(
    '',
    [
        body('playerId').isInt(),
        body('mainServer').custom(isServer),
        body('eventId').optional().isInt(),
        body('useEasyBG').isBoolean(),
        body('compress').optional().isBoolean(),
        body('liveVariant').optional().isString(),
    ],
    middleware,
    async (req: Request, res: Response) => {
        const {
            playerId, mainServer, eventId, useEasyBG, compress, liveVariant,
        } = req.body;

        try {
            const result = await commandPtMaximize(
                playerId,
                getServerByServerId(mainServer),
                useEasyBG,
                compress ?? true,
                eventId,
                liveVariant ?? null,
            );
            res.send(listToBase64(result));
        } catch (e) {
            console.log(e);
            const message = e instanceof Error ? e.message : '内部错误';
            res.status(500).send(listToBase64([message]));
        }
    }
);

router.post('/updatePtSong',
    [
        body('playerId').isInt(),
        body('mainServer').custom(isServer),
        body('songId').isInt({ min: 1 }),
        body('difficulty').isInt({ min: 0, max: 4 }),
    ],
    middleware,
    async (req: Request, res: Response) => {
        const { playerId, songId, difficulty } = req.body;
        await playerDB.updatePtSong(playerId, songId, difficulty);
        res.send(listToBase64([`PT计算歌曲已设置为: ${songId} ${['ez','nm','hd','ex','sp'][difficulty]}`]));
    }
);

export async function commandPtMaximize(
    playerId: number,
    mainServer: Server,
    useEasyBG: boolean,
    compress: boolean,
    eventId?: number,
    userLiveVariant?: string | null,
): Promise<Array<Buffer | string>> {
    // 0. 提前获取玩家数据，用于确定活动和歌曲
    const player = await playerDB.getPlayer(playerId);
    const pt: PtConfig = player?.ptConfig ?? DEFAULT_PT_CONFIG;

    // 1. 获取活动: 优先使用命令参数 eventId，其次玩家 currentEvent，最后当前正在进行的活动
    const resolvedEventId = eventId ?? player?.currentEvent;
    let currentEvent = resolvedEventId
        ? new Event(resolvedEventId)
        : getPresentEvent(mainServer);

    if (!currentEvent || !currentEvent.isExist) {
        return ['无法确定当前活动'];
    }
    // 组曲活动不支持PT计算
    if (currentEvent.eventType == 'medley') {
        return ['PT计算不支持组曲(medley)活动, 请使用 开始计算; 切换活动请发送 组队计算 <活动ID>'];
    }
    const perf = perfMark(`commandPtMaximize e${currentEvent.eventId} ${Server[mainServer]}`)
    await currentEvent.initFull();
    perf('活动数据获取');
    const evId = currentEvent.eventId;
    const eventType = currentEvent.eventType;

    // 2. 按兼容矩阵确定 liveVariant
    let liveVariant: LiveVariant;
    try {
        liveVariant = resolveLiveVariant(eventType, userLiveVariant);
    } catch (e) {
        return [e instanceof Error ? e.message : String(e)];
    }

    // 3. 获取歌曲: 优先使用「协力歌曲」设置，其次「选择歌曲」第一首，最后活动默认
    let songs: SongSelection[];
    if (player?.ptSong) {
        songs = [{ songId: player.ptSong.songId, difficulty: player.ptSong.difficulty }];
    } else {
        const eventSongs = player?.eventSongs?.[evId];
        if (eventSongs && eventSongs.length > 0) {
            songs = [{ songId: eventSongs[0].songId, difficulty: eventSongs[0].difficulty }];
        } else {
            songs = getDefaultSongs(currentEvent, mainServer);
        }
    }
    if (songs.length === 0) {
        songs.push({ ...DEFAULT_PT_SONG });
    }

    // 4. 构造 PtMaximizeRequest — 所有字段都赋值
    const request: Record<string, unknown> = {
        eventType,
        liveVariant,
        songs,
        minimumPersonalStat: PT_DEFAULTS.minimumPersonalStat,
    };

    // mission_live: 始终传入 missionSupportPtBonus (从用户设置的支援综合力换算)
    if (eventType === 'mission_live') {
        request.missionSupportPtBonus = Math.floor(pt.supportStat / 3000);
    }

    // 按 liveVariant 填入模式专属参数（全部从用户 ptConfig 读取）
    switch (liveVariant) {
        case 'cooperative':
            request.cooperative = buildCooperativeInput(pt);
            break;
        case 'challenge_cp':
            // CP 模式为单人打歌，无需队友参数
            break;
        case 'versus':
            request.versus = buildVersusInput(pt);
            break;
        case 'festival':
            request.festival = buildFestivalInput(pt);
            break;
    }

    // 5. 调用 optimize
    const reqBody = {
        playerId,
        server: Server[mainServer],
        eventId: evId,
        request,
    };
    console.log('ptMaximize request:', JSON.stringify(reqBody));

    let response;
    try {
        response = await axios.post<ApiEnvelope<PtMaximizeResult>>(
            optimizeCalcApiUrl,
            reqBody,
            {
                timeout:
                    Number(process.env.BANGDREAM_OPTIMIZE_TIMEOUT_MS) || 120000,
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

    // 6. 渲染
    try {
        const viewOpts: { missionSupportPtBonus?: number; player?: typeof player } = {};
        if (eventType === 'mission_live') {
            viewOpts.missionSupportPtBonus = Math.floor(pt.supportStat / 3000);
        }
        viewOpts.player = player;
        const buffers = await drawPtMaximizeResult(
            body.data,
            evId,
            useEasyBG,
            compress,
            viewOpts,
        );
        perf('结果渲染');
        return buffers;
    } catch (e) {
        console.error('ptMaximize draw error:', e);
        return [
            'PT 结果渲染失败: ' +
                (e instanceof Error ? e.message : String(e)),
        ];
    }
}

export { router as ptMaximizeRouter };
