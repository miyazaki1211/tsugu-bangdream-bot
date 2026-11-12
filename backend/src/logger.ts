export function logger(type: string, message: any) {
    const requestTime = Date.now();
    // hh:mm:ss
    const timeString = new Date(requestTime).toString().split(' ')[4];
    console.log(`[${timeString}] [${type}] ${message}`);
}

/**
 * 性能调试: 创建分步计时器
 * const perf = perfMark('scope'); ... perf('stepName');
 * 每次调用输出该步耗时与累计耗时, 形如 [Perf] scope | stepName +123ms (total 456ms)
 */
export function perfMark(scope: string) {
    const t0 = Date.now();
    let last = t0;
    return (label: string): number => {
        const now = Date.now();
        const stepMs = now - last;
        last = now;
        logger('Perf', `${scope} | ${label} +${stepMs}ms (total ${now - t0}ms)`);
        return stepMs;
    };
}