import { callAPIAndCacheResponse } from '@/api/getApi';
import { getJsonAndSave } from '@/api/downloader';
import { getCacheDirectory, getFileNameFromUrl } from '@/api/utils';
import { ensureLocalRankingSourceInited } from '@/api/rankingSourceInit';
import { Bestdoriurl, LOCAL_RANKING_API_URL, USE_LOCAL_RANKING_API } from '@/config';
import { Server } from '@/types/Server';
import { logger } from '@/logger';

/*
 * 玩家数据获取：国服优先尝试本地 GarupaSpeedTracker 的 /api/player 接口（与 Bestdori 同格式），
 * 本地请求的 mode 固定为 3（严格实时），失败或超时（30s）后回退 Bestdori 并沿用调用方原始 mode。
 * 本地尝试为单次请求且不做磁盘旧缓存兜底，确保本地失败时真正回退到 Bestdori；
 * Bestdori 分支保持 callAPIAndCacheResponse 的原有重试与旧缓存兜底行为。
 * 非国服不经过本地实例（本地实例仅配置了国服直连数据）。
 */
export async function fetchPlayerDataPreferLocal(server: Server, playerId: number, mode: 0 | 1 | 2 | 3, cacheTime: number): Promise<object> {
    await ensureLocalRankingSourceInited();
    if (USE_LOCAL_RANKING_API && LOCAL_RANKING_API_URL && server == Server.cn) {
        const localUrl = `${LOCAL_RANKING_API_URL}/api/player/${Server[server]}/${playerId}?mode=3`;
        try {
            return await getJsonAndSave(localUrl, getCacheDirectory(localUrl), getFileNameFromUrl(localUrl), cacheTime);
        }
        catch (e) {
            logger('playerSource', `本地 GarupaSpeedTracker 玩家数据获取失败，回退 Bestdori: ${e.message}`);
        }
    }
    return await callAPIAndCacheResponse(`${Bestdoriurl}/api/player/${Server[server]}/${playerId}?mode=${mode}`, cacheTime, 1);
}
