import axios from 'axios';
import { LOCAL_RANKING_API_URL, STAR_VIEWER_Url } from '@/config';
import { logger } from '@/logger';
import mainAPI from '@/types/_Main';

// 用 Tracker 数据源（本地 GarupaSpeedTracker / STAR_VIEWER）的活动列表补全 mainAPI['events'] 中缺失的活动时间。
// 背景：bestdori 对新开放的活动（尤其国服）常常在活动开始一段时间后才补上 startAt/endAt，
// 在此期间 getPresentEvent 解析不到进行中的活动，档线/前十车速等指令会回退到上一期刚结束的活动，
// 并提示"没有进行中的活动"。Tracker 直连游戏服采集排名，其活动列表时间与活动实际开放同步。
// 只补全 bestdori 缺失（null）的时间，不覆盖 bestdori 已有的数据，也不新增 bestdori 未收录的活动。

const OVERLAY_REFRESH_MS = 60 * 1000;
const SERVER_COUNT = 5;

type TrackerEventEntry = {
    startAt?: Array<string | null>;
    endAt?: Array<string | null>;
};

let trackerEventList: Record<string, TrackerEventEntry> | null = null;
let lastGoodSourceName = '';
let refreshTimer: ReturnType<typeof setInterval> | null = null;

function candidateSources(): { url: string, name: string }[] {
    const sources: { url: string, name: string }[] = [];
    if (LOCAL_RANKING_API_URL) {
        sources.push({ url: LOCAL_RANKING_API_URL, name: 'local_gs' });
    }
    sources.push({ url: STAR_VIEWER_Url, name: 'star_viewer' });
    //优先尝试上次成功的数据源，减少本地数据源不可达时的等待
    if (lastGoodSourceName) {
        const index = sources.findIndex((source) => source.name == lastGoodSourceName);
        if (index > 0) {
            sources.unshift(sources.splice(index, 1)[0]);
        }
    }
    return sources;
}

async function fetchTrackerEventList(): Promise<void> {
    for (const source of candidateSources()) {
        try {
            const response = await axios.get(`${source.url}/api/events`, { timeout: 5000, validateStatus: () => true });
            if (response.status == 200 && response.data && typeof response.data == 'object' && !Array.isArray(response.data)) {
                trackerEventList = response.data as Record<string, TrackerEventEntry>;
                lastGoodSourceName = source.name;
                return;
            }
            logger('eventTimeOverlay', `数据源 ${source.name} /api/events 响应异常 (HTTP ${response.status})`);
        }
        catch (e) {
            logger('eventTimeOverlay', `数据源 ${source.name} /api/events 获取失败: ${e.message}`);
        }
    }
    //所有数据源都失败时保留上一次的结果，等待下个周期重试
}

export function applyEventTimeOverlay(): void {
    const events = mainAPI['events'];
    if (!events || !trackerEventList) {
        return;
    }
    let patched = 0;
    const examples: string[] = [];
    for (const id of Object.keys(trackerEventList)) {
        const trackerEntry = trackerEventList[id];
        const target = events[id];
        if (!target || !Array.isArray(trackerEntry.startAt) || !Array.isArray(trackerEntry.endAt)) {
            continue;
        }
        if (!Array.isArray(target.startAt) || !Array.isArray(target.endAt)) {
            continue;
        }
        for (let server = 0; server < SERVER_COUNT; server++) {
            const startAt = trackerEntry.startAt[server];
            const endAt = trackerEntry.endAt[server];
            //只补全开始与结束时间成对已知的条目
            if (startAt == null || endAt == null) {
                continue;
            }
            if (target.startAt[server] == null && target.endAt[server] == null) {
                target.startAt[server] = startAt;
                target.endAt[server] = endAt;
                patched++;
                if (examples.length < 3) {
                    examples.push(`event ${id} server ${server}`);
                }
            }
        }
    }
    if (patched > 0) {
        logger('eventTimeOverlay', `已用Tracker数据补全 ${patched} 条活动时间 (${examples.join(', ')})`);
    }
}

async function refreshAndApply(): Promise<void> {
    await fetchTrackerEventList();
    applyEventTimeOverlay();
}

export function startEventTimeOverlay(): void {
    if (refreshTimer) {
        return;
    }
    logger('eventTimeOverlay', '启动活动时间补全 (Tracker → mainAPI.events)');
    refreshAndApply();
    refreshTimer = setInterval(refreshAndApply, OVERLAY_REFRESH_MS);
}
