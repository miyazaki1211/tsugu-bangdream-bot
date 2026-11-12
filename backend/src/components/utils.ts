import { Chart } from 'chart.js';
import { Canvas, Image } from 'skia-canvas';
import { logger } from '@/logger';
import { recordCanvasReleased, recordChartDestroyed } from '@/monitoring/memoryMonitor';

export function stackImage(list: Array<Image | Canvas>) {
    var maxW = 0
    var allH = 0
    for (var i = 0; i < list.length; i++) {
        if (list[i].width > maxW) {
            maxW = list[i].width
        }
        allH += list[i].height
    }
    var tempcanv = new Canvas(maxW, allH)
    var ctx = tempcanv.getContext("2d")
    var allH2 = 0
    for (var i = 0; i < list.length; i++) {
        ctx.drawImage(list[i], 0, allH2)
        allH2 = allH2 + list[i].height
    }
    return (tempcanv)
}

export function stackImageHorizontal(list: Array<Image | Canvas>) {
    var maxH = 0
    var allW = 0
    for (var i = 0; i < list.length; i++) {
        if (list[i].height > maxH) {
            maxH = list[i].height
        }
        allW += list[i].width
    }
    var tempcanv = new Canvas(allW, maxH)
    var ctx = tempcanv.getContext("2d")
    var allW2 = 0
    for (var i = 0; i < list.length; i++) {
        ctx.drawImage(list[i], allW2, 0)
        allW2 = allW2 + list[i].width
    }
    return (tempcanv)
}

interface resizeImageOptions {
    image: Image | Canvas,
    heightMax?: number,
    widthMax?: number
}
//输入canvas或Image，高度，宽度，返回等比例缩放到限制高度的canvas
export function resizeImage({
    image,
    heightMax,
    widthMax
}: resizeImageOptions) {
    var height = image.height
    var width = image.width
    if (heightMax != undefined) {
        width = width * heightMax / height
        height = heightMax
    }
    if (widthMax != undefined) {
        height = height * widthMax / width
        width = widthMax
    }
    var canvas = new Canvas(width, height)
    var ctx = canvas.getContext('2d')
    ctx.drawImage(image, 0, 0, width, height)
    return canvas
}
/**
 * 从尾部向前收集最近 MAX_WINDOW_MS 分钟内 EP 发生变化的数据点（跳过连续重复 EP），
 * 至多 MAX_POINTS 个，对这些点做线性回归求斜率，作为当前有效时速。
 * MAX_WINDOW_MS 分钟窗口确保反映实时速度，避免使用过旧数据。
 * windowMinutes: 参与计算的第一个与最后一个数据点的时间差（分钟）。
 * 确定有效数据点前会先剔除异常数据点：档线 EP 随时间单调不减，
 * 任何低于前一有效点的数据点视为数据源异常（如爬虫坏点导致 EP 骤降）并跳过。
 */
export function getSpeedParams(
    cutoffs: { time: number; ep: number }[],
    startAt: number
): { lastep: number; timeSpanHours: number; windowMinutes: number } {
    const MAX_WINDOW_MS = 35 * 60 * 1000;
    const MAX_POINTS = 10;

    if (!cutoffs || cutoffs.length === 0) {
        return { lastep: 0, timeSpanHours: 1, windowMinutes: 0 };
    }

    const last = cutoffs[cutoffs.length - 1];

    if (cutoffs.length === 1) {
        const span = Math.max((last.time - startAt) / 3600000, 0.01);
        return { lastep: 0, timeSpanHours: span, windowMinutes: 0 };
    }

    const valid: { time: number; ep: number }[] = [];
    for (let i = 0; i < cutoffs.length; i++) {
        if (valid.length === 0 || cutoffs[i].ep >= valid[valid.length - 1].ep) {
            valid.push(cutoffs[i]);
        }
    }

    // 收集最近 MAX_WINDOW_MS 分钟内 EP 发生变化的数据点（至多 MAX_POINTS 个）
    const anchor = valid[valid.length - 1];
    const changed: { time: number; ep: number }[] = [];
    let prevEp: number | null = null;
    for (let i = valid.length - 1; i >= 0 && changed.length < MAX_POINTS; i--) {
        // 超出 MAX_WINDOW_MS 分钟窗口则停止
        if (anchor.time - valid[i].time > MAX_WINDOW_MS) {
            break;
        }
        if (valid[i].ep !== prevEp) {
            changed.unshift({ time: valid[i].time, ep: valid[i].ep });
            prevEp = valid[i].ep;
        }
    }

    // 不足 2 个变化点则速度为 0（MAX_WINDOW_MS 分钟内无变化或仅 1 个点）
    if (changed.length < 2) {
        return { lastep: last.ep, timeSpanHours: 1, windowMinutes: 0 };
    }

    // 对收集到的点做线性回归求斜率 (EP/ms)
    const slope = regressSlope(changed);

    const speedPerHour = slope * 3600000;
    const windowMinutes = (changed[changed.length - 1].time - changed[0].time) / 60000;
    return { lastep: last.ep - speedPerHour, timeSpanHours: 1, windowMinutes };
}

/**
 * 近2小时平均时速: 基点取距「最新点前2小时」正负3分钟内、最接近该时刻的数据点，
 * 时速 = (最新EP - 基点EP) / 实际时间跨度(小时)。
 * 若 ±3 分钟内不存在有效数据点（即有效数据不足2小时），返回 null。
 */
export function getTwoHourSpeed(cutoffs: { time: number; ep: number }[]): number | null {
    if (!cutoffs || cutoffs.length < 2) {
        return null;
    }
    const last = cutoffs[cutoffs.length - 1];
    const targetTime = last.time - 2 * 3600000;
    const TOLERANCE_MS = 3 * 60 * 1000;
    // 在 2h ± 3 分钟范围内寻找最接近目标时刻的数据点
    let base: { time: number; ep: number } | null = null;
    let minDiff = Infinity;
    for (const p of cutoffs) {
        const diff = Math.abs(p.time - targetTime);
        if (diff <= TOLERANCE_MS && diff < minDiff) {
            base = p;
            minDiff = diff;
        }
    }
    if (base == null) {
        return null; // 有效数据不足2小时
    }
    const spanHours = Math.max((last.time - base.time) / 3600000, 0.01);
    return (last.ep - base.ep) / spanHours;
}

/** 线性回归斜率 (EP per ms)。points 至少 2 个元素。 */
function regressSlope(points: { time: number; ep: number }[]): number {
    const n = points.length;
    const t0 = points[0].time;

    let sumDt = 0, sumEp = 0;
    for (const p of points) {
        sumDt += p.time - t0;
        sumEp += p.ep;
    }
    const meanDt = sumDt / n;
    const meanEp = sumEp / n;

    let numerator = 0, denominator = 0;
    for (const p of points) {
        const dt = (p.time - t0) - meanDt;
        numerator += dt * (p.ep - meanEp);
        denominator += dt * dt;
    }

    return denominator > 0 ? numerator / denominator : 0;
}

export function destroyChartButKeepingCanvas(chart: Chart | undefined): void {
    if (!chart) return;

    try {
        // Chart.destroy() normally clears its canvas. Detach it first so the
        // rendered pixels remain available to the caller, while the rest of
        // Chart.js still follows its public destruction lifecycle.
        if (chart.canvas) {
            (chart as any).unbindEvents?.();
        }
        (chart as any).canvas = null;
        (chart as any).ctx = null;
        chart.destroy();
    } catch (error) {
        logger('ChartDestroy', `Failed to destroy chart: ${error}`);
    } finally {
        recordChartDestroyed(Object.keys(Chart.instances).length);
    }
}

export function releaseCanvas(canvas: Canvas | undefined): void {
    if (!canvas) return;
    const width = canvas.width;
    const height = canvas.height;
    let failed = false;
    try {
        const context = canvas.getContext('2d');
        context?.reset?.();
        canvas.width = 0;
        canvas.height = 0;
    } catch (error) {
        failed = true;
        logger('CanvasRelease', `Failed to release canvas: ${error}`);
    } finally {
        recordCanvasReleased(width, height, failed);
    }
}
