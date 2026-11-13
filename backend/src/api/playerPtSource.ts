import axios from 'axios';
import { LOCAL_RANKING_API_URL } from '@/config';
import { logger } from '@/logger';
import { extractTrackerErrorMessage } from '@/api/trackerError';

/*
 * 玩家 PT 数据获取：通过本地 GarupaSpeedTracker 的 GET /api/playerPt 接口
 * 查询指定玩家的活动 pt/排名/邻近排名 与 月榜 pt/排名（仅国服, server=3）。
 * 该接口为实时抓取国服游戏服, 上游自带 30 秒内存缓存, 此处不做本地缓存。
 * 文档见 GarupaSpeedTracker/backend/API.md 的 GET /api/playerPt 小节。
 */

//排名条目（活动 near/border 与月榜 near/border 通用）
export interface PlayerPtRankingUser {
    uid: number
    name: string
    introduction: string
    rank: number
    sid: number
    strained: number
    degrees: number[]
    tier: number
    point: number
}

export interface PlayerPtEventInfo {
    eventId: number
    eventType: string
    eventName: string
    startAt: number
    endAt: number
}

export interface PlayerPtData {
    server: number
    userId: number
    time: number
    cache: boolean
    event: {
        info?: PlayerPtEventInfo
        point?: number
        rank?: number | null
        state?: object
        near: PlayerPtRankingUser[]
        border: PlayerPtRankingUser[]
    }
    monthly: {
        monthlyRankingId: number
        monthlyRankingName: string
        startAt: number
        endAt: number
        point: number | null
        rank: number | null
        near: PlayerPtRankingUser[]
        border: PlayerPtRankingUser[]
    }
}

export interface PlayerPtResponse {
    result: boolean
    platform?: string
    data: PlayerPtData
}

/**
 * 本人登录凭据（tracker 强制）：B站扫码登录凭据，成对使用。
 */
export interface PlayerPtCreds {
    channelUid?: string
    channelToken?: string
}

export async function fetchLocalPlayerPt(playerId: number, creds: PlayerPtCreds, platform?: string): Promise<{ data: PlayerPtData; platform?: string }> {
    if (!LOCAL_RANKING_API_URL) {
        throw new Error('本地数据源未配置');
    }
    // tracker 的 user 域请求强制本人登录凭据
    const params = new URLSearchParams({ server: '3', playerId: String(playerId) });
    if (creds.channelUid && creds.channelToken) {
        params.set('channelUid', creds.channelUid);
        params.set('channelToken', creds.channelToken);
    }
    else {
        throw new Error('缺少本人登录凭据');
    }
    // platform (ios|android): 已存储时显式传入可跳过 tracker 的双平台登录探测; 未存储时省略, 由响应回传后写库
    if (platform) {
        params.set('platform', platform);
    }
    const url = `${LOCAL_RANKING_API_URL.replace(/\/+$/, '')}/api/playerPt?${params.toString()}`;
    try {
        const response = await axios.get<PlayerPtResponse>(url, { timeout: 30000 });
        return { data: response.data.data, platform: response.data.platform };
    }
    catch (e) {
        if (axios.isAxiosError(e)) {
            if (e.response) {
                const status = e.response.status;
                //tracker 错误体带具体原因(如凭据不匹配时实际登录到的 uid), 透传给用户
                const upstreamMessage = extractTrackerErrorMessage(e.response.data);
                logger('playerPtSource', `playerPt 查询失败 (HTTP ${status}): ${JSON.stringify(e.response.data)?.slice(0, 200)}`);
                if (status == 405) {
                    throw new Error('令牌无效或已过期, 请在私信中重新发送 设置令牌 扫码配置');
                }
                if (status == 400) {
                    //凭据与玩家不匹配等: 优先透传 tracker 的简短原因
                    throw new Error(upstreamMessage ?? '令牌与玩家ID不一致, 请重新设置令牌');
                }
                if (status == 502 || status == 504) {
                    throw new Error('游戏服务器错误, 请稍后重试');
                }
                throw new Error(upstreamMessage ?? `数据源返回错误 (HTTP ${status})`);
            }
            logger('playerPtSource', `playerPt 查询失败: ${e.message}`);
            throw new Error('无法连接到本地数据源, 请稍后再试');
        }
        throw e;
    }
}
