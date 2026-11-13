import axios from 'axios';
import { LOCAL_RANKING_API_URL } from '@/config';
import { logger } from '@/logger';
import { extractTrackerErrorMessage } from '@/api/trackerError';

/*
 * 广告位（档位边界名次）玩家数据获取：通过本地 GarupaSpeedTracker 的
 *   GET /api/tracker/borderPlayers         — 活动 PT 榜 + 全部歌榜的广告位玩家
 *   GET /api/monthlyRanking/borderPlayers  — 月榜的广告位玩家
 * 实时抓取国服游戏服（仅国服, server=3）, 上游自带 30 秒内存缓存, 此处不做本地缓存。
 * 文档见 GarupaSpeedTracker/backend/API.md 的 GET /api/tracker/borderPlayers 与
 * GET /api/monthlyRanking/borderPlayers 小节。
 */

//广告位玩家条目（PT 榜/歌榜/月榜通用）
//tier=档位名次, point=PT 或歌曲分数, rank=玩家等级, sid/strained=头像卡与特训状态,
//degrees=佩戴牌子; 其余 raw 字段（ownFlg/userDeck 等）此处不使用, 缺省时接口会省略
export interface BorderPlayer {
    tier: number
    uid: number
    name: string
    point: number
    introduction?: string
    rank: number
    sid: number
    strained: number
    degrees?: number[]
}

export interface EventBorderPlayersResponse {
    result: boolean
    server: number
    eventId: number
    eventType: string
    time: number
    cache: boolean
    eventPoint: BorderPlayer[]
    musicRankings: Array<{
        musicId: number
        players: BorderPlayer[]
    }>
}

export interface MonthlyBorderPlayersResponse {
    result: boolean
    server: number
    monthlyId: number
    time: number
    cache: boolean
    players: BorderPlayer[]
}

async function fetchFromTracker<T>(path: string, notFoundMessage: string): Promise<T> {
    if (!LOCAL_RANKING_API_URL) {
        throw new Error('本地数据源未配置');
    }
    const url = `${LOCAL_RANKING_API_URL.replace(/\/+$/, '')}${path}`;
    try {
        const response = await axios.get<T>(url, { timeout: 30000 });
        return response.data;
    }
    catch (e) {
        if (axios.isAxiosError(e)) {
            if (e.response) {
                const status = e.response.status;
                //tracker 错误体带具体原因(如档位不在白名单), 透传给用户
                const upstreamMessage = extractTrackerErrorMessage(e.response.data);
                logger('borderPlayersSource', `borderPlayers 查询失败 (HTTP ${status}): ${JSON.stringify(e.response.data)?.slice(0, 200)}`);
                if (status == 404) {
                    throw new Error(notFoundMessage);
                }
                if (status == 422) {
                    //tracker 统一 422 契约: 具体原因在 message/details, 优先透传
                    throw new Error(upstreamMessage ?? '参数无效, 请确认活动或月榜 ID 是否正确');
                }
                if (status == 502 || status == 504) {
                    throw new Error('游戏服务器错误, 请稍后重试');
                }
                throw new Error(upstreamMessage ?? `数据源返回错误 (HTTP ${status})`);
            }
            logger('borderPlayersSource', `borderPlayers 查询失败: ${e.message}`);
            throw new Error('无法连接到本地数据源, 请稍后再试');
        }
        throw e;
    }
}

/*
 * 查询活动 PT 榜与歌榜的广告位玩家（server 固定国服）。
 * event 必填：调用方需先解析活动 ID（如 getPresentEvent(Server.cn)）。
 */
export async function fetchEventBorderPlayers(eventId: number): Promise<EventBorderPlayersResponse> {
    return await fetchFromTracker<EventBorderPlayersResponse>(
        `/api/tracker/borderPlayers?server=3&event=${eventId}`,
        `未找到活动 ${eventId} 或该活动没有排名数据`
    );
}

/*
 * 查询月榜的广告位玩家（server 固定国服）。
 * monthlyId 可选：缺省时由上游自动解析当前月榜期（间隔期回退最近结束一期）。
 */
export async function fetchMonthlyBorderPlayers(monthlyId?: number): Promise<MonthlyBorderPlayersResponse> {
    let path = '/api/monthlyRanking/borderPlayers?server=3';
    if (monthlyId != undefined) {
        path += `&monthlyId=${monthlyId}`;
    }
    return await fetchFromTracker<MonthlyBorderPlayersResponse>(
        path,
        monthlyId == undefined ? '未找到当前月榜数据' : `未找到 ${monthlyId} 期月榜数据`
    );
}
