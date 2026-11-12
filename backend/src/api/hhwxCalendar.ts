import { callAPIAndCacheResponse } from '@/api/getApi';
import { HHWX_Url } from '@/config';
import mainAPI from '@/types/_Main';


export interface CalendarEvent {
    eventId: number;
    band: { label: string, color: string };
    /** 活动条文案: "乐队名 N期 角色名 : 活动名" */
    label: string;
    /** 活动开始时间 (epoch ms) */
    start: number;
    /** 活动结束时间 (epoch ms, 含当天) */
    end: number;
    /** 档期是否为预测值 (cnSchedule, 官方未公布) */
    predicted: boolean;
}

export interface CnHolidays {
    /** 休 (放假日), 格式 YYYY-MM-DD */
    restDays: string[];
    /** 班 (调休上班日), 格式 YYYY-MM-DD */
    makeupWorkDays: string[];
}

// 乐队 key → 显示名与主题色 (与 hhwx.org 前端一致)
export const BAND_MAP: Record<string, { label: string, color: string }> = {
    'ppp': { label: "Poppin'Party", color: '#FF3377' },
    'ag': { label: 'Afterglow', color: '#EE3344' },
    'pp': { label: 'Pastel*Palettes', color: '#33DDAA' },
    'roselia': { label: 'Roselia', color: '#3344AA' },
    'hhw': { label: 'Hello, Happy World!', color: '#FFDD00' },
    'morfonica': { label: 'Morfonica', color: '#33AAFF' },
    'ras': { label: 'RAISE A SUILEN', color: '#33CCCC' },
    'mygo': { label: 'MyGO!!!!!', color: '#3388BB' },
    'mix': { label: '混活', color: '#888888' }
};

interface HhwxEventMaster {
    eventType?: string;
    /** [jp, en, tw, cn], 元素可为 null */
    eventName?: (string | null)[];
    band?: string;
    /** [jp, en, tw, cn], 元素可为 null; 值为 epoch ms 的字符串或数字 */
    startAt?: (number | string | null)[];
    endAt?: (number | string | null)[];
    /** HHWX 扩展: 国服预测档期 (官方未公布 startAt[3] 时使用) */
    cnSchedule?: { startAt?: number | string, endAt?: number | string } | null;
    /** 日历展示的看板角色 */
    stampCharacterId?: number | null;
}

interface HhwxEventsResponse { success?: boolean, data?: Record<string, HhwxEventMaster> }
interface HhwxHolidaysResponse { success?: boolean, data?: { restDays?: string[], makeupWorkDays?: string[] } }

/** 获取活动日历数据 (活动列表 + 国服节假日), 结果已按开始时间排序 */
export async function getCalendarData(): Promise<{ events: CalendarEvent[], holidays: CnHolidays }> {
    const eventsMaster = await callAPIAndCacheResponse(`${HHWX_Url}/api/bandori/master/events`, 60 * 60) as HhwxEventsResponse;
    const holidays = await getHolidays();
    const events: CalendarEvent[] = [];
    for (const id of Object.keys(eventsMaster.data ?? {})) {
        const e = eventsMaster.data[id];
        const range = getEventRange(e);
        if (!range) continue;
        const bandKey = e.band ?? 'mix';
        events.push({
            eventId: Number(id),
            band: BAND_MAP[bandKey] ?? BAND_MAP['mix'],
            label: buildEventLabel(Number(id), e),
            start: range.start,
            end: range.end,
            predicted: range.predicted
        });
    }
    events.sort((a, b) => a.start - b.start);
    return { events, holidays };
}

/** 国服节假日与调休日 */
export async function getHolidays(): Promise<CnHolidays> {
    const res = await callAPIAndCacheResponse(`${HHWX_Url}/api/bandori/calendar/cn/holidays`, 60 * 60 * 24) as HhwxHolidaysResponse;
    return {
        restDays: res.data?.restDays ?? [],
        makeupWorkDays: res.data?.makeupWorkDays ?? []
    };
}

/** 活动档期: 官方公布 (startAt[3]) 优先, 否则使用 cnSchedule 预测; 两者皆无返回 null */
function getEventRange(e: HhwxEventMaster): { start: number, end: number, predicted: boolean } | null {
    if (e.startAt && e.startAt[3] != null && e.endAt && e.endAt[3] != null) {
        return { start: Number(e.startAt[3]), end: Number(e.endAt[3]), predicted: false };
    }
    if (e.cnSchedule?.startAt != null && e.cnSchedule?.endAt != null) {
        return { start: Number(e.cnSchedule.startAt), end: Number(e.cnSchedule.endAt), predicted: true };
    }
    return null;
}

/** 活动条文案, 与 hhwx.org 日历一致: "乐队名 N期 角色名 : 活动名" */
function buildEventLabel(eventId: number, e: HhwxEventMaster): string {
    const bandKey = e.band ?? 'mix';
    const band = BAND_MAP[bandKey] ?? BAND_MAP['mix'];
    const name = e.eventName?.[3] || e.eventName?.[0] || e.eventName?.[1] || e.eventName?.[2] || '';
    const character = getCharacterName(e.stampCharacterId);
    const parts = [band.label, `${eventId}期`];
    if (character) parts.push(character);
    parts.push(':', name);
    return parts.filter(p => p !== '').join(' ');
}

/** 角色中文名 (cn, 无则 jp), 数据来自后端已有的 Bestdori characters 主数据 */
function getCharacterName(characterId?: number | null): string {
    if (characterId == null) return '';
    const character = (mainAPI as Record<string, Record<string, { characterName?: (string | null)[] }>>)['characters']?.[String(characterId)];
    if (!character?.characterName) return '';
    return character.characterName[3] || character.characterName[0] || '';
}
