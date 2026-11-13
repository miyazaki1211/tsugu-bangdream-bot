import axios from 'axios';
import { LOCAL_RANKING_API_URL } from '@/config';
import { logger } from '@/logger';
import { PlayerPtCreds, PlayerPtEventInfo, PlayerPtRankingUser } from '@/api/playerPtSource';
import { extractTrackerErrorMessage } from '@/api/trackerError';

/*
 * 玩家歌榜数据获取：通过本地 GarupaSpeedTracker 的 GET /api/playerMusic 接口
 * 查询指定玩家当期活动每曲排名/分数/邻近玩家（仅国服, server=3）。
 * 曲目集合由响应决定（challenge≈3曲 / versus≈1曲 / medley=合计榜1条, musicId=1）,
 * 此处逐曲透传不做二次过滤; 上游自带 30 秒内存缓存, 此处不做本地缓存。
 * 文档见 GarupaSpeedTracker/backend/API.md 的 GET /api/playerMusic 小节。
 */

//单曲歌榜条目（near 为该曲榜以本人为基准的邻近列表）
export interface PlayerMusicRankingData {
    musicId: number
    point?: number | null    //本人该曲分数;未上榜为 null
    rank?: number | null     //本人该曲排名;未上榜为 null
    near: PlayerPtRankingUser[]  //与 tracker RankingUserRaw 同构, 复用 playerPtSource 类型
}

export interface PlayerMusicData {
    server: number
    userId: number
    time: number
    cache: boolean
    event?: PlayerPtEventInfo    //复用 playerPtSource 类型
    musics: PlayerMusicRankingData[]
}

export interface PlayerMusicResponse {
    result: boolean
    platform?: string
    data: PlayerMusicData
}

export async function fetchLocalPlayerMusic(playerId: number, creds: PlayerPtCreds, platform?: string): Promise<{ data: PlayerMusicData; platform?: string }> {
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
    const url = `${LOCAL_RANKING_API_URL.replace(/\/+$/, '')}/api/playerMusic?${params.toString()}`;
    try {
        const response = await axios.get<PlayerMusicResponse>(url, { timeout: 30000 });
        return { data: response.data.data, platform: response.data.platform };
    }
    catch (e) {
        if (axios.isAxiosError(e)) {
            if (e.response) {
                const status = e.response.status;
                //tracker 错误体带具体原因(如凭据不匹配时实际登录到的 uid), 透传给用户
                const upstreamMessage = extractTrackerErrorMessage(e.response.data);
                logger('playerMusicSource', `playerMusic 查询失败 (HTTP ${status}): ${JSON.stringify(e.response.data)?.slice(0, 200)}`);
                if (status == 405) {
                    throw new Error('令牌无效或已过期, 请在私信中重新发送 设置令牌 扫码配置');
                }
                if (status == 400) {
                    //凭据与玩家不匹配等: 优先透传 tracker 的简短原因
                    throw new Error(upstreamMessage ?? '令牌与玩家ID不一致, 请重新设置令牌');
                }
                if (status == 422) {
                    //tracker 统一 422 契约: 具体原因(如活动类型不在白名单)在 message/details, 优先透传
                    throw new Error(upstreamMessage ?? '请求参数无效');
                }
                if (status == 502 || status == 504) {
                    throw new Error('游戏服务器错误, 请稍后重试');
                }
                throw new Error(upstreamMessage ?? `数据源返回错误 (HTTP ${status})`);
            }
            logger('playerMusicSource', `playerMusic 查询失败: ${e.message}`);
            throw new Error('无法连接到本地数据源, 请稍后再试');
        }
        throw e;
    }
}
