import { Canvas, Image } from 'skia-canvas';
import { getCalendarData } from '@/api/hhwxCalendar';
import { logger, perfMark } from '@/logger';
import { imageCompressQuality } from '@/config';
import { Character } from '@/types/Character';
import mainAPI from '@/types/_Main';

// 确保 old 字体已注册 (FontLibrary.use 在该模块顶层执行)
import '@/image/text';

// ===== 国服活动日历渲染 =====
// 视觉规格参考 hhwx.org/bandori/calendar: 暖白底、周一起始的 7 列月历、
// 按乐队配色的跨天活动条、预测档期虚线边框、休/班角标、今天高亮、成员生日头像

// CST(UTC+8) 天数工具
const DAY_MS = 86400000;
/** epoch ms → CST 日序号 (startAt 可能是字符串, 必须 Number()) */
function dayNum(ts: number | string): number {
    return Math.floor((Number(ts) + 8 * 3600000) / DAY_MS);
}
/** CST 日序号 → YYYY-MM-DD (取当天正午即 04:00 UTC 再读 UTC 日期, 避免零点时刻归属前一天) */
function ymdOfDay(n: number): string {
    return new Date(n * DAY_MS + 4 * 3600000).toISOString().slice(0, 10);
}
function domOfDay(n: number): number {
    return Number(ymdOfDay(n).slice(8, 10));
}
function monthOfDay(n: number): number {
    return Number(ymdOfDay(n).slice(5, 7));
}
/** CST 日序号 → 星期几 (0=周日) */
function dowOf(n: number): number {
    return new Date(n * DAY_MS + 4 * 3600000).getUTCDay();
}
/** CST 日序号 → 网格列 (0=周一) */
function colOf(n: number): number {
    return (dowOf(n) + 6) % 7;
}

// ===== 布局与配色常量 =====
const W = 1100, MARGIN = 36, PAD = 14;
const INK = '#0F172A', MUTED = '#64748B', FAINT = '#94A3B8';
const RED = '#EF392B', HOLIDAY_RED = '#C2322B', BLUE = '#0A78A8';
const PAGE_BG = '#FAF8F4';
const PANEL_BG = '#FCFCFC', PANEL_BORDER = '#DDDCD5';
const CELL_BG = '#EEF1F5', CELL_BG_HOL = '#F7E4E1', CELL_BG_OFF = '#ECECEA';
const REST_BADGE_BG = '#F6D9D6', MAKEUP_BADGE_BG = '#DDE4EC';
const TITLE_H = 108, HEAD_H = 54, ROW_H = 222, FOOT_H = 64;
const HEADERS = ['一', '二', '三', '四', '五', '六', '日'];

// 游戏内 8 支主要乐队 (Poppin'Party / Afterglow / Pastel*Palettes / Roselia /
// Hello, Happy World! / RAISE A SUILEN / Morfonica / MyGO!!!!!) 的 bandId
const MAIN_BAND_IDS = new Set([1, 2, 3, 4, 5, 18, 21, 45]);

/** 加深活动条色块: 亮度越高压得越狠, 保证白字可读(黄/薄荷绿最需要) */
function darkenBar(hexColor: string): string {
    const n = parseInt(hexColor.slice(1), 16);
    const r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
    const lum = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
    const f = lum > 0.55 ? 0.6 : lum > 0.35 ? 0.72 : 0.85;
    const to = (v: number) => Math.round(v * f).toString(16).padStart(2, '0');
    return `#${to(r)}${to(g)}${to(b)}`;
}

// ===== 成员生日标注 =====
// 生日数据来自 Bestdori 角色详情 (profile.birthday 为 JST 零点的毫秒时间戳字符串)。
// 生日与头像均不变, 进程内只加载一次。

interface BirthdayMember {
    characterId: number;
}

/** 键为 'MM-DD' (JST 月日, 与 ymdOfDay().slice(5) 对齐) */
let birthdayTablePromise: Promise<Map<string, BirthdayMember[]>> | null = null;
const birthdayIconCache = new Map<number, Image>();

async function buildBirthdayTable(): Promise<Map<string, BirthdayMember[]>> {
    const table = new Map<string, BirthdayMember[]>();
    const characters = mainAPI['characters'];
    if (!characters || Object.keys(characters).length === 0) {
        return table;
    }
    await Promise.all(Object.keys(characters).map(async (idStr) => {
        const characterId = parseInt(idStr);
        try {
            const character = new Character(characterId);
            if (!character.isExist || !MAIN_BAND_IDS.has(character.bandId)) {
                return;
            }
            await character.initFull(true);
            const ts = Number(character.profile && character.profile.birthday);
            if (!Number.isFinite(ts)) {
                return;
            }
            // 时间戳为 JST 零点: 平移 +9h 后读 UTC 字段即 JST 月日, 与服务器时区无关
            const jst = new Date(ts + 9 * 3600000);
            const key = `${String(jst.getUTCMonth() + 1).padStart(2, '0')}-${String(jst.getUTCDate()).padStart(2, '0')}`;
            const members = table.get(key) || [];
            members.push({ characterId });
            table.set(key, members);
        } catch (e) {
            // 单个成员数据缺失不影响整表
            logger('calendar', `加载成员 ${idStr} 生日数据失败: ${e.message}`);
        }
    }));
    return table;
}

async function getBirthdayTable(): Promise<Map<string, BirthdayMember[]>> {
    if (!birthdayTablePromise) {
        birthdayTablePromise = buildBirthdayTable();
    }
    const table = await birthdayTablePromise;
    if (table.size === 0) {
        // mainAPI 尚未就绪等情况下的空表不缓存, 下次请求重建
        birthdayTablePromise = null;
    }
    return table;
}

async function getBirthdayIcon(characterId: number): Promise<Image | undefined> {
    if (birthdayIconCache.has(characterId)) {
        return birthdayIconCache.get(characterId);
    }
    try {
        const icon = await new Character(characterId).getIcon();
        birthdayIconCache.set(characterId, icon);
        return icon;
    } catch (e) {
        logger('calendar', `下载成员 ${characterId} 头像失败: ${e.message}`);
        return undefined;
    }
}

export async function drawCalendar(year: number, month: number, compress: boolean = false): Promise<Array<Buffer | string>> {
    const perf = perfMark(`calendar.drawCalendar ${year}-${month}`);

    const { events, holidays } = await getCalendarData();
    perf('getCalendarData');

    const birthdayTable = await getBirthdayTable();
    perf('birthdayTable');

    // 月历网格: 周一开头
    const first = dayNum(Date.UTC(year, month - 1, 1));
    const gridStart = first - colOf(first);
    const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
    const gridEnd = first + daysInMonth - 1;
    const weeks = Math.ceil((gridEnd - gridStart + 1) / 7);

    const GRID_W = W - MARGIN * 2 - PAD * 2;
    const CELL_W = GRID_W / 7;
    const H = MARGIN * 2 + TITLE_H + PAD + HEAD_H + weeks * ROW_H + PAD + FOOT_H;

    const canvas = new Canvas(W, H);
    const ctx = canvas.getContext('2d');
    const F = (textSize: number, weight?: string) => `${weight ? weight + ' ' : ''}${textSize}px old,Microsoft Yahei`;

    function roundRect(x: number, y: number, w: number, h: number, r: number) {
        const radius = Math.min(r, w / 2, h / 2);
        ctx.beginPath();
        ctx.moveTo(x + radius, y);
        ctx.arcTo(x + w, y, x + w, y + h, radius);
        ctx.arcTo(x + w, y + h, x, y + h, radius);
        ctx.arcTo(x, y + h, x, y, radius);
        ctx.arcTo(x, y, x + w, y, radius);
        ctx.closePath();
    }
    function text(str: string, x: number, y: number, font: string, color: string, align: CanvasTextAlign = 'left') {
        ctx.font = font; ctx.fillStyle = color; ctx.textAlign = align; ctx.textBaseline = 'alphabetic';
        ctx.fillText(str, x, y);
    }
    function ellipsize(str: string, maxW: number, font: string): string {
        ctx.font = font;
        if (ctx.measureText(str).width <= maxW) return str;
        let s = str;
        while (s.length > 1 && ctx.measureText(s + '…').width > maxW) s = s.slice(0, -1);
        return s + '…';
    }

    // 背景(暖白)
    ctx.fillStyle = PAGE_BG;
    ctx.fillRect(0, 0, W, H);

    // 标题区
    text('BanG Dream! 国服活动日历', MARGIN, MARGIN + 46, F(46, 'bold'), RED);
    text('数据源 hhwx.org · 国服限定', W - MARGIN, MARGIN + 30, F(20, 'bold'), MUTED, 'right');
    const nowCn = new Date(Date.now() + 8 * 3600000);
    text(`生成于 ${nowCn.toISOString().slice(0, 10)} ${nowCn.toISOString().slice(11, 16)} (UTC+8)`, W - MARGIN, MARGIN + 60, F(20), MUTED, 'right');
    text(`${year}年${month}月`, MARGIN, MARGIN + TITLE_H - 22, F(38, 'bold'), INK);

    // 面板
    const panelX = MARGIN, panelY = MARGIN + TITLE_H;
    const panelW = W - MARGIN * 2, panelH = H - panelY - MARGIN - FOOT_H;
    ctx.fillStyle = PANEL_BG; ctx.strokeStyle = PANEL_BORDER; ctx.lineWidth = 2;
    roundRect(panelX, panelY, panelW, panelH, 18); ctx.fill(); ctx.stroke();

    // 星期表头(周一开始, 周末红)
    for (let c = 0; c < 7; c++) {
        const x = panelX + PAD + c * CELL_W;
        text(HEADERS[c], x + CELL_W / 2, panelY + PAD + 36, F(28, 'bold'), c >= 5 ? HOLIDAY_RED : INK, 'center');
    }

    // 周行
    const todayNum = dayNum(Date.now());
    for (let w = 0; w < weeks; w++) {
        const rowY = panelY + PAD + HEAD_H + w * ROW_H;
        const weekStart = gridStart + w * 7;

        // 单元格底色 + 日期
        for (let c = 0; c < 7; c++) {
            const d = weekStart + c;
            const x = panelX + PAD + c * CELL_W;
            const y = rowY;
            const inMonth = monthOfDay(d) === month;
            const ymd = ymdOfDay(d);
            const isRest = holidays.restDays.includes(ymd);
            const isMakeup = holidays.makeupWorkDays.includes(ymd);
            const weekend = c >= 5;

            ctx.fillStyle = !inMonth ? CELL_BG_OFF : (weekend || isRest) ? CELL_BG_HOL : CELL_BG;
            ctx.fillRect(x, y, c === 6 ? CELL_W : CELL_W - 2, ROW_H - 8);

            if (d === todayNum) {
                ctx.fillStyle = BLUE;
                roundRect(x + 10, y + 10, 40, 40, 20); ctx.fill();
                text(String(domOfDay(d)), x + 30, y + 40, F(26, 'bold'), '#FFFEF4', 'center');
            } else {
                const color = !inMonth ? FAINT : (weekend || isRest) ? HOLIDAY_RED : INK;
                text(String(domOfDay(d)), x + 30, y + 40, F(26, 'bold'), color, 'center');
            }
            // 休/班 角标
            if (isRest && inMonth) {
                ctx.fillStyle = REST_BADGE_BG; roundRect(x + 56, y + 14, 30, 30, 8); ctx.fill();
                text('休', x + 71, y + 37, F(19, 'bold'), HOLIDAY_RED, 'center');
            } else if (isMakeup && inMonth) {
                ctx.fillStyle = MAKEUP_BADGE_BG; roundRect(x + 56, y + 14, 30, 30, 8); ctx.fill();
                text('班', x + 71, y + 37, F(19, 'bold'), MUTED, 'center');
            }
        }

        // 活动条(与本周有交集的活动, 已按开始时间排序, 每周最多 3 条)
        const inWeek = events.filter(e => dayNum(e.start) <= weekStart + 6 && dayNum(e.end) >= weekStart);
        inWeek.slice(0, 3).forEach((e, i) => {
            const evStart = dayNum(e.start), evEnd = dayNum(e.end);
            const segStart = Math.max(evStart, weekStart);
            const segEnd = Math.min(evEnd, weekStart + 6);
            const x = panelX + PAD + colOf(segStart) * CELL_W + 5;
            const width = (colOf(segEnd) - colOf(segStart) + 1) * CELL_W - 10;
            const y = rowY + 62 + i * 36;
            const h = 30;
            // 只有真实起点/终点在本周内才有圆角, 跨周边缘为方角
            const roundL = evStart >= weekStart;
            const roundR = evEnd <= weekStart + 6;
            const r = 15;

            ctx.globalAlpha = 0.97;
            ctx.fillStyle = darkenBar(e.band.color);
            ctx.beginPath();
            ctx.moveTo(x + (roundL ? r : 0), y);
            ctx.lineTo(x + width - (roundR ? r : 0), y);
            if (roundR) ctx.arcTo(x + width, y, x + width, y + h, r); else ctx.lineTo(x + width, y);
            ctx.lineTo(x + width, y + h - (roundR ? r : 0));
            if (roundR) ctx.arcTo(x + width, y + h, x + width - r, y + h, r); else ctx.lineTo(x + width, y + h);
            ctx.lineTo(x + (roundL ? r : 0), y + h);
            if (roundL) ctx.arcTo(x, y + h, x, y + h - r, r); else ctx.lineTo(x, y + h);
            ctx.lineTo(x, y + (roundL ? r : 0));
            if (roundL) ctx.arcTo(x, y, x + r, y, r); else ctx.lineTo(x, y);
            ctx.closePath();
            ctx.fill();
            ctx.globalAlpha = 1;

            // 预测档期: 白色虚线内边框
            if (e.predicted) {
                ctx.save();
                ctx.strokeStyle = 'rgba(255,255,255,0.9)'; ctx.lineWidth = 2.5;
                ctx.setLineDash([7, 5]);
                roundRect(x + 3, y + 3, width - 6, h - 6, Math.min(12, width / 2));
                ctx.stroke();
                ctx.restore();
            }

            const label = (evStart < weekStart ? '… ' : '') + e.label + (evEnd > weekStart + 6 ? ' …' : '');
            text(ellipsize(label, width - 20, F(19, 'bold')), x + 10, y + 22, F(19, 'bold'), '#FFFFFF');
        });

        // 成员生日标注: 当天格底部居中绘制头像 (仅本月, 同日多人生日并列, 如冰川姐妹 3/20)
        for (let c = 0; c < 7; c++) {
            const d = weekStart + c;
            if (monthOfDay(d) !== month) continue;
            const members = birthdayTable.get(ymdOfDay(d).slice(5));
            if (!members || members.length === 0) continue;
            const size = members.length === 1 ? 42 : members.length === 2 ? 35 : 29;
            const gap = 5;
            const totalW = members.length * size + (members.length - 1) * gap;
            let ax = panelX + PAD + c * CELL_W + (CELL_W - totalW) / 2;
            const ay = rowY + ROW_H - 8 - size - 6;
            for (const member of members) {
                const icon = await getBirthdayIcon(member.characterId);
                if (icon) {
                    ctx.save();
                    roundRect(ax, ay, size, size, size / 3);
                    ctx.clip();
                    // 头像居中裁切铺满 (object-fit: cover)
                    const s = Math.min(icon.width, icon.height);
                    ctx.drawImage(icon, (icon.width - s) / 2, (icon.height - s) / 2, s, s, ax, ay, size, size);
                    ctx.restore();
                    ctx.strokeStyle = 'rgba(15,23,42,0.18)';
                    ctx.lineWidth = 1;
                    roundRect(ax + 0.5, ay + 0.5, size - 1, size - 1, size / 3);
                    ctx.stroke();
                }
                ax += size + gap;
            }
        }
    }

    // 页脚图例
    const legendY = H - MARGIN - 34;
    const birthdayLegendIcon = await getBirthdayIcon(1);
    const legend: Array<{ t: string, solid?: string, dashed?: boolean, avatar?: boolean }> = [
        { t: '官方档期', solid: '#3344AA' },
        { t: '预测档期(虚线)', dashed: true },
        { t: '休/班=节假日', solid: HOLIDAY_RED },
        { t: '成员生日', avatar: true },
    ];
    let legendX = MARGIN;
    for (const l of legend) {
        if (l.avatar) {
            if (birthdayLegendIcon) {
                const s = 24;
                ctx.save();
                roundRect(legendX, legendY - 20, s, s, s / 3);
                ctx.clip();
                const src = Math.min(birthdayLegendIcon.width, birthdayLegendIcon.height);
                ctx.drawImage(birthdayLegendIcon, (birthdayLegendIcon.width - src) / 2, (birthdayLegendIcon.height - src) / 2, src, src, legendX, legendY - 20, s, s);
                ctx.restore();
            }
        } else if (l.dashed) {
            ctx.strokeStyle = '#33DDAA'; ctx.lineWidth = 3; ctx.setLineDash([6, 4]);
            roundRect(legendX, legendY - 14, 22, 16, 5); ctx.stroke(); ctx.setLineDash([]);
        } else {
            ctx.fillStyle = l.solid; roundRect(legendX, legendY - 14, 22, 16, 5); ctx.fill();
        }
        text(l.t, legendX + 30, legendY, F(19, 'bold'), MUTED);
        legendX += 30 + ctx.measureText(l.t).width + 36;
    }
    text('仅供参考 · 以游戏内公告为准', W - MARGIN, legendY, F(19), FAINT, 'right');

    const buffer = compress ? await canvas.toBuffer('jpeg', { quality: imageCompressQuality }) : await canvas.toBuffer('png');
    perf('render');
    return [buffer];
}
