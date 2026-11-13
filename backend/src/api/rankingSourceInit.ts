import axios from 'axios';
import { LOCAL_RANKING_API_URL, enableLocalRankingAPI } from '@/config';
import { logger } from '@/logger';

// 启动时探测一次本地 GarupaSpeedTracker 数据源是否可用（端口可达且接口正常响应）。
// 可用时将 local_gs 数据源插入排名回退链最前（star_viewer 之前）；不可用时保持原有数据源顺序。
// 通过 ensureLocalRankingSourceInited() 在各排名数据解析入口等待探测完成，保证首次请求即生效。
let initPromise: Promise<void> | null = null;

async function probeLocalRankingAPI(): Promise<void> {
    if (!LOCAL_RANKING_API_URL) {
        logger('rankingSourceInit', 'LOCAL_RANKING_API_URL 为空，禁用本地 GarupaSpeedTracker 数据源');
        return;
    }
    const probeUrl = `${LOCAL_RANKING_API_URL}/api/events`;
    const startTime = Date.now();
    try {
        const response = await axios.get(probeUrl, { timeout: 2500, validateStatus: () => true });
        if (response.status < 500) {
            enableLocalRankingAPI();
            logger('rankingSourceInit', `本地 GarupaSpeedTracker 数据源可用 (${probeUrl} HTTP ${response.status} ${Date.now() - startTime}ms)，国服排名数据将优先使用本地数据源`);
        } else {
            logger('rankingSourceInit', `本地 GarupaSpeedTracker 数据源响应异常 (${probeUrl} HTTP ${response.status})，保持原有数据源顺序`);
        }
    } catch (e) {
        logger('rankingSourceInit', `本地 GarupaSpeedTracker 数据源不可达 (${probeUrl}: ${e.message})，保持原有数据源顺序`);
    }
}

export function ensureLocalRankingSourceInited(): Promise<void> {
    if (!initPromise) {
        initPromise = probeLocalRankingAPI();
    }
    return initPromise;
}
