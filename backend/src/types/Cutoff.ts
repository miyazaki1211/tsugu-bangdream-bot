import { callAPIAndCacheResponse } from '@/api/getApi';
import { keepAliveAxiosConfig } from '@/api/httpAgent';
import { ensureLocalRankingSourceInited } from '@/api/rankingSourceInit';
import mainAPI from '@/types/_Main';
import { Bestdoriurl, STAR_VIEWER_Url, STAR_VIEWER_TIER_LIST, USE_HHWX_SOURCE_PREFER, USE_STAR_VIEWER_SOURCE_PREFER, EVENTRANKING_TURNS, resolveSourceUrls, tierListOfServer } from '@/config';
import { Server } from '@/types/Server';
import { Event, getPresentEvent } from '@/types/Event';
import { predict } from '@/api/cutoff.cjs'
import { logger, perfMark } from '@/logger';
import { normalizeTimestamp, getDateByServerTimezone, getServerUtcOffset, GetProbablyTimeDifference } from '@/components/list/time';
import axios from 'axios';

const predictServerURL = `${process.env.PREDICT_SERVER_URL || 'http://127.0.0.1:8000'}/predictions/`;

export class Cutoff {
    eventId: number;
    server: Server;
    tier: number;
    isExist = false;
    cutoffs: { time: number, ep: number }[];
    prefix_curve: { time: number, ep: number }[] = [];
    history: { time: number, ep: number }[] = [];
    eventType: string;
    latestCutoff: { time: number, ep: number };
    rate: number | null;
    predictEP: number;
    startAt: number;
    endAt: number;
    status: 'not_start' | 'in_progress' | 'ended';
    isInitfull: boolean = false;
    useHHWX = USE_HHWX_SOURCE_PREFER;
    useSTAR_VIEWER = USE_STAR_VIEWER_SOURCE_PREFER;
    dailyIncrement = [];
    dailyIncrementInvalidDays: number[] = [];
    currentGetDataTime
    constructor(eventId: number, server: Server, tier: number) {
        const event = new Event(eventId)
        //如果活动不存在，直接返回
        if (!event.isExist) {
            this.isExist = false;
            return
        }
        this.eventType = event.eventType
        this.eventId = eventId
        this.server = server
        //如果该档线不在该服的档线列表中，直接返回
        if (!tierListOfServer[Server[server]].includes(tier)) {
            this.isExist = false;
            return
        }
        this.tier = tier
        this.isExist = true;
        // this.startAt = event.startAt[server]
        // this.endAt = event.endAt[server]
        // 当该活动在服务器上尚未存在时，使用预测的时间去推断startAt以及endAt，以解决部分情况下卡死及档线状态不对的问题
        const estimatedStartAt = server == Server.cn
            ? GetProbablyTimeDifference(this.eventId, getPresentEvent(this.server))
            : undefined
        this.startAt = event.startAt[server] ?? estimatedStartAt
        this.endAt = event.endAt[server] ?? (
            estimatedStartAt == null
                ? undefined
                : estimatedStartAt + (event.endAt[Server.jp] - event.startAt[Server.jp])
        )
        this.currentGetDataTime = new Date().getTime()
        //状态
        var time = new Date().getTime()
        if (time < this.startAt) {
            this.status = 'not_start'
        }
        else if (time > this.endAt) {
            this.status = 'ended'
        }
        else {
            this.status = 'in_progress'
        }
    }
    getFinalApiUrl (reverse:boolean){   // reverse:是否反向获取。假如useHHWX/useSTAR_VIEWER为False，当反向开启后就使用对应数据源
        if (this.server == Server.cn){  // 国服使用STAR_VIEWER优先，Bestdori作为临时回退
            var url = !reverse ? STAR_VIEWER_Url : Bestdoriurl
            return url
        }
        else if (this.server == Server.jp){  // 日服使用STAR_VIEWER优先，Bestdori作为临时回退
            var url = !reverse ? STAR_VIEWER_Url : Bestdoriurl
            return url
        }
        else {  // 其他服不使用回退数据源
            this.useHHWX = false
            this.useSTAR_VIEWER = false
            return Bestdoriurl
        }
    }
    async getFinalCutoffsData (forceReadCache:boolean = false ){
        return await this.tryTrackerSources(forceReadCache);
    }

    private getTrackerSources(): { url: string, name: string }[] {
        return resolveSourceUrls(Server[this.server], EVENTRANKING_TURNS);
    }

    private async tryTrackerSources(forceReadCache: boolean, startIndex: number = 0): Promise<object | null> {
        await ensureLocalRankingSourceInited();
        const cacheTime = forceReadCache ? 1/0 : 0;
        const sources = this.getTrackerSources();

        for (let i = startIndex; i < sources.length; i++) {
            // 仅 star_viewer 受档位白名单限制；local_gs（本地 GarupaSpeedTracker）原生支持 400 档，不做限制
            if (sources[i].name == 'star_viewer' && !STAR_VIEWER_TIER_LIST.includes(this.tier)) {
                logger('Perf', `tracker source[${i}] star_viewer 不支持 t${this.tier}, 跳过 (e${this.eventId})`);
                continue;
            }
            const tSource = Date.now();
            try {
                const data = await callAPIAndCacheResponse(
                    `${sources[i].url}/api/tracker/data?server=${<number>this.server}&event=${this.eventId}&tier=${this.tier}`,
                    cacheTime, 3
                );
                if (data?.['result'] === false) {
                    logger('Perf', `tracker source[${i}] ${sources[i].name} empty ${Date.now() - tSource}ms (e${this.eventId} t${this.tier})`);
                    continue;
                }
                logger('Perf', `tracker source[${i}] ${sources[i].name} OK ${Date.now() - tSource}ms (e${this.eventId} t${this.tier})`);
                return data;
            } catch (e) {
                logger('Perf', `tracker source[${i}] ${sources[i].name} ERR ${Date.now() - tSource}ms ${e.message} (e${this.eventId} t${this.tier})`);
                if (e.response?.status != 404) {
                    logger('Cutoff.ts/tryTrackerSources', `${sources[i].name}获取失败，尝试下一个`);
                }
            }
        }
        return null;
    }
    //当日增计算出现插值天数(!)时, 按回退链尝试各数据源, 采用插值天数严格更少的数据源, 否则保持原数据
    private async tryFallbackSourcesForDailyIncrement(forceReadCache: boolean) {
        if (!this.cutoffs || this.cutoffs.length === 0) {
            return
        }
        if (!this.dailyIncrementInvalidDays || this.dailyIncrementInvalidDays.length === 0) {
            return
        }
        const invalidCount = this.dailyIncrementInvalidDays.length
        await ensureLocalRankingSourceInited();
        const sources = this.getTrackerSources()
        const cacheTime = forceReadCache ? 1/0 : 0
        for (let i = 0; i < sources.length; i++) {
            if (sources[i].name == 'star_viewer' && !STAR_VIEWER_TIER_LIST.includes(this.tier)) {
                continue
            }
            let data
            try {
                data = await callAPIAndCacheResponse(
                    `${sources[i].url}/api/tracker/data?server=${<number>this.server}&event=${this.eventId}&tier=${this.tier}`,
                    cacheTime, 3
                );
            } catch (e) {
                logger('Cutoff.ts/tryFallbackSourcesForDailyIncrement', `${sources[i].name}获取失败，跳过 (e${this.eventId} t${this.tier}): ${e.message}`)
                continue
            }
            if (data?.['result'] === false) {
                continue
            }
            const altCutoffs = data?.['cutoffs'] as { time: number, ep: number }[]
            if (!altCutoffs || altCutoffs.length === 0 || altCutoffs === this.cutoffs) {
                continue
            }
            let altResult: { dailyIncrement: string[], invalidDays: number[] }
            try {
                altResult = this.computeDailyIncrementFrom(altCutoffs)
            }
            catch (e) {
                logger('Cutoff.ts/tryFallbackSourcesForDailyIncrement', `${sources[i].name}日增计算失败，跳过 (e${this.eventId} t${this.tier}): ${e.message}`)
                continue
            }
            if (altResult.invalidDays.length < invalidCount) {
                logger('Cutoff.ts/tryFallbackSourcesForDailyIncrement', `e${this.eventId} ${Server[this.server]} t${this.tier}: ${sources[i].name} 日增插值 ${altResult.invalidDays.length} 天, 少于当前数据源 ${invalidCount} 天, 采用回退数据`)
                this.cutoffs = altCutoffs
                this.latestCutoff = altCutoffs[altCutoffs.length - 1]
                this.getDailyIncrement()
                return
            }
        }
    }
    async initFull() {
        if (this.isInitfull) {
            return
        }
        if (this.isExist == false) {
            return
        }
        const perf = perfMark(`Cutoff.initFull e${this.eventId} ${Server[this.server]} t${this.tier} status=${this.status}`)
        let cutoffData
        //如果cutoff的活动已经结束，则使用缓存
        const time = new Date().getTime()
        if (time < this.endAt + 1000 * 60 * 60 * 24 * 2) {
            cutoffData = await this.getFinalCutoffsData()
            perf('getFinalCutoffsData(no-cache)')
            if (!cutoffData){
                this.isExist = false;
                return
            }
            // var dateNow = Date.now()
            // 活动进行中：数据距当前超过45分钟视为不实时；活动已结束后数据不再更新，改为校验末点是否接近活动结束时间（阈值与2天后的缓存校验一致）
            const eventEnded = time > this.endAt
            const lastDataTime = cutoffData["cutoffs"]?.length ? cutoffData["cutoffs"][cutoffData["cutoffs"].length - 1].time : null
            const dataOutdated = lastDataTime != null && (eventEnded ? this.endAt - lastDataTime > 410000 : time - lastDataTime >= 2700000)
            if (this.server == Server.cn && dataOutdated){   // CN: 主数据源数据校验不通过，按回退链尝试后续数据源
                const sourceNames = this.getTrackerSources().map(s => s.name)
                logger('Cutoff.ts/initFull', `CN主数据源(${sourceNames[0]})数据${eventEnded ? '完整性' : '实时性(>45分钟)'}校验不通过，尝试回退`)
                var cutoffData2 = await this.tryTrackerSources(false, 1);
                perf(`cnFallback->${sourceNames[1]}`)
                if (cutoffData2?.["cutoffs"]?.length && cutoffData2["cutoffs"][cutoffData2["cutoffs"].length-1].time > lastDataTime){
                    cutoffData = cutoffData2;
                    logger('Cutoff.ts/initFull', `CN回退至${sourceNames[1]}数据源，数据更新`)
                } else {
                    var cutoffData3 = await this.tryTrackerSources(false, 2);
                    perf(`cnFallback->${sourceNames[2]}`)
                    if (cutoffData3?.["cutoffs"]?.length && cutoffData3["cutoffs"][cutoffData3["cutoffs"].length-1].time > lastDataTime){
                        cutoffData = cutoffData3;
                        logger('Cutoff.ts/initFull', `CN回退至${sourceNames[2]}数据源，数据更新`)
                    }
                }
            }
            if (this.server == Server.jp && dataOutdated){   // JP: 主数据源数据校验不通过，按回退链尝试后续数据源
                const sourceNames = this.getTrackerSources().map(s => s.name)
                logger('Cutoff.ts/initFull', `JP主数据源(${sourceNames[0]})数据${eventEnded ? '完整性' : '实时性(>45分钟)'}校验不通过，尝试回退`)
                var cutoffData2 = await this.tryTrackerSources(false, 1);
                perf(`jpFallback->${sourceNames[1]}`)
                if (cutoffData2?.["cutoffs"]?.length && cutoffData2["cutoffs"][cutoffData2["cutoffs"].length-1].time > lastDataTime){
                    cutoffData = cutoffData2;
                    logger('Cutoff.ts/initFull', `JP回退至${sourceNames[1]}数据源，数据更新`)
                }
            }
        }
        else {
            var useCache = true
            cutoffData = await this.getFinalCutoffsData(useCache)
            perf('getFinalCutoffsData(cache)')
            // 检查缓存是否合法
            if (cutoffData?.["cutoffs"] && (cutoffData["cutoffs"].length==0|| (cutoffData["cutoffs"].length!=0 && this.endAt - cutoffData["cutoffs"][cutoffData["cutoffs"].length-1].time >410000) )){
                cutoffData = await this.getFinalCutoffsData()
                perf('getFinalCutoffsData(cacheInvalid-refetch)')
            } //如果最后一个记录的时间减去endAt，校验如果差距太大就要更新
        }
        if (cutoffData == undefined) {
            this.isExist = false;
            return
        }
        else if (cutoffData['result'] == false) {
            this.isExist = false;
            return
        }
        this.isExist = true;
        this.cutoffs = cutoffData['cutoffs'] as { time: number, ep: number }[]
        if (this.cutoffs.length == 0) {
            const event = new Event(this.eventId)
            this.latestCutoff = { time: event.startAt[this.server], ep: 0 }
            return
        }
        else {
            this.latestCutoff = this.cutoffs[this.cutoffs.length - 1]
        }
        //rate
        let rateDataList = mainAPI['rates'] as [{ server: number, type: string, tier: number, rate: number }]
        let rateData = rateDataList.find((element) => {
            return element.server == this.server && element.type == this.eventType && element.tier == this.tier
        }
        )
        if (rateData == undefined) {
            this.rate = null
        }
        else {
            this.rate = rateData.rate
        }
        try{
            this.getDailyIncrement()
        }
        catch{

        }
        //若当前数据源的日增存在插值(!), 回退到其余数据源获取更完整的数据
        try {
            await this.tryFallbackSourcesForDailyIncrement(!(time < this.endAt + 1000 * 60 * 60 * 24 * 2))
        }
        catch (e) {
            logger('Cutoff.ts/initFull', `日增数据源回退失败 (e${this.eventId} t${this.tier}): ${e.message}`)
        }
        if (this.status == 'in_progress') {
            await this.predict()
            perf('predict')
        }
        this.isInitfull = true
    }
    async predict(): Promise<number> {
        if (this.isExist == false) {
            return
        }
        // 保留 medley 分支现有的国服外部预测服务及其历史/走势曲线。
        if (this.server == Server.cn) {
            try {
                const tPredict = Date.now();
                const response = await axios.get(
                    `${predictServerURL}${this.eventId}?server=${this.server}&tier=${this.tier}`,
                    { timeout: 30000, ...keepAliveAxiosConfig(`${predictServerURL}${this.eventId}?server=${this.server}&tier=${this.tier}`) }
                );
                logger('Perf', `Cutoff.predict | external predict e${this.eventId} t${this.tier} took=${Date.now() - tPredict}ms`);
                const data = response.data;
                this.history = data["history"] ?? [];
                this.prefix_curve = data["latest_slice"]?.["prefix_curve"] ?? [];
                this.predictEP = data["latest_slice"]?.["total_sum_hat"] ?? 0;
                return this.predictEP;
            }
            catch (e) {
                logger('Cutoff.ts/predict', `外部预测服务请求失败，回退到本地预测: ${e.message}`);
            }
        }
        const event = new Event(this.eventId)
        let start_ts = Math.floor(event.startAt[this.server] / 1000)
        let end_ts = Math.floor(event.endAt[this.server] / 1000)
        let cutoff_ts: { time: number, ep: number }[] = []
        for (let i = 0; i < this.cutoffs.length; i++) {
            const element = this.cutoffs[i];
            cutoff_ts.push({ time: Math.floor(element.time / 1000), ep: element.ep })
        }
        try {
            var result = predict(cutoff_ts, start_ts, end_ts, this.rate)
        } catch (e) {
            console.log(e)
            this.predictEP = 0
            return this.predictEP
        }
        this.predictEP = Math.floor(result.ep)
        return this.predictEP
    }
    getPredictionHistory(): { time: number, ep: number }[] {
        if (this.isExist == false || !this.cutoffs) {
            return []
        }
        const event = new Event(this.eventId)
        const start_ts = Math.floor(event.startAt[this.server] / 1000)
        const end_ts = Math.floor(event.endAt[this.server] / 1000)
        const cutoff_ts: { time: number, ep: number }[] = []
        for (let i = 0; i < this.cutoffs.length; i++) {
            const element = this.cutoffs[i]
            cutoff_ts.push({ time: Math.floor(element.time / 1000), ep: element.ep })
        }
        const history: { time: number, ep: number }[] = []
        for (let i = 0; i < cutoff_ts.length; i++) {
            let result
            try {
                result = predict(cutoff_ts.slice(0, i + 1), start_ts, end_ts, this.rate)
            } catch (e) {
                continue
            }
            if (result && result.ep && !isNaN(result.ep) && result.ep !== 0) {
                history.push({ time: this.cutoffs[i].time, ep: Math.floor(result.ep) })
            }
        }
        return history
    }
    getDaysOfEvent(ts: number) {
        if (!this.startAt) return 0
        const offsetMs = getServerUtcOffset(this.server) * 60 * 60 * 1000
        const eventStartAtTime = normalizeTimestamp(this.startAt)
        const timestamp = normalizeTimestamp(ts)

        const serverStartTime = eventStartAtTime + offsetMs

        const startDate = new Date(serverStartTime)

        const hour = startDate.getUTCHours()
        const minute = startDate.getUTCMinutes()
        const second = startDate.getUTCSeconds()
        const millisecond = startDate.getUTCMilliseconds()

        let firstDayEndServerTime =
            serverStartTime +
            ((86400000 + 4 * 60 * 60 * 1000)
                - hour * 60 * 60 * 1000
                - minute * 60 * 1000
                - second * 1000
                - millisecond)

        const firstDayEndTime = firstDayEndServerTime - offsetMs

        if (timestamp < firstDayEndTime) {
            return 0
        } else {
            return Math.ceil((timestamp - firstDayEndTime) / 86400000)
        }
    }
    getDailyIncrement(){
        if (!this.cutoffs || this.cutoffs.length === 0){
            return
        }
        const result = this.computeDailyIncrementFrom(this.cutoffs)
        this.dailyIncrement = result.dailyIncrement
        this.dailyIncrementInvalidDays = result.invalidDays
    }
    //对给定的档线数据计算日增(单位:万), 同时返回插值天数索引, 供数据源回退比较使用。要求cutoffs非空
    computeDailyIncrementFrom(cutoffs: { time: number, ep: number }[]): { dailyIncrement: string[], invalidDays: number[] }{
        let score:number[] = []
        let time:number[] = []
        // 收集 3:40~3:50 UTC 窗口内的数据点，每天只保留最接近3:45的一个
        let candidatePoints: { ep: number, time: number, day: number, minutesDiff: number }[] = []
        for (const c of cutoffs) {
            const timestamp = normalizeTimestamp(c.time)
            const date = getDateByServerTimezone(timestamp, this.server)
            if ((this.server == Server.cn || this.server == Server.tw || this.server == Server.jp) && date.getUTCHours() === 3 && date.getUTCMinutes() >= 40 && date.getUTCMinutes() <= 50) {
                candidatePoints.push({ ep: c.ep, time: timestamp, day: this.getDaysOfEvent(timestamp), minutesDiff: Math.abs(date.getUTCMinutes() - 45) })
            }
        }
        // 按天去重，每天只保留最接近3:45的数据点，并按时间顺序排列
        let dayMap = new Map<number, { ep: number, time: number, minutesDiff: number }>()
        for (const p of candidatePoints) {
            const existing = dayMap.get(p.day)
            if (!existing || p.minutesDiff < existing.minutesDiff) {
                dayMap.set(p.day, { ep: p.ep, time: p.time, minutesDiff: p.minutesDiff })
            }
        }
        let sortedDays = Array.from(dayMap.keys()).sort((a, b) => a - b)
        for (const day of sortedDays) {
            const p = dayMap.get(day)!
            score.push(p.ep)
            time.push(p.time)
        }
        let dailyIncrement = []
        let dailyIncrementInvaildDays:number[]  = []
        let scoreFinal:number[] = []
        var j = 0   // 临时天数存放
        var cutoffLastDataDays = this.getDaysOfEvent(cutoffs[cutoffs.length-1].time)   // 最后一个数据的天数
        // 头处理
        if (score.length == 0){
            for (var i = 0;i<=this.getDaysOfEvent(cutoffs[cutoffs.length-1].time);i++){
                if (this.getDaysOfEvent(cutoffs[cutoffs.length-1].time) == 0){
                    scoreFinal.push(cutoffs[cutoffs.length-1].ep)
                    break
                }
                let avgIncrementValue = Math.round(((cutoffs[cutoffs.length-1].ep)/(this.getDaysOfEvent(cutoffs[cutoffs.length-1].time))))    // 计算丢失的天数的平均增量
                scoreFinal.push(Math.round(avgIncrementValue * (i+1)))  // 把丢失的天数的数据补全
                dailyIncrementInvaildDays.push(scoreFinal.length-1)  // 记录增量数据不完整的天数位置
                j++ // 增加一天
            }
        }

        for (var i = 0;i<score.length;i++){
            if (score.length == 0) break
            if (this.getDaysOfEvent(time[i]) == j){ // 如果当天相对于活动而言天数是i，说明数据完整
                if (this.getDaysOfEvent(time[i]) == 0){ // 如果是第0天，且有数据，说明第一天虽然不满24小时，但有数据了，就直接把第一天增量设为当天的ep
                    scoreFinal.push(score[i])
                    j++
                }
                else{       // 如果是第i天，且有数据，说明当天数据完整，直接用当天的ep减去前一天的ep就是当天的增量
                    scoreFinal.push(score[i])
                    j++
                }
            }else{  // i跟相对于getDaysOfEvent的结果不一致，说明当天数据不完整，进行插值计算
                // 当i = 0时，就说明要从0开始而不是score[i-1]开始插值
                if (this.getDaysOfEvent(time[i]) > j){  // 如果这个数据是大于标记天数的，则说明需要进行插值计算
                    let lostDays = this.getDaysOfEvent(time[i]) - j +1
                    let avgIncrementValue = Math.round((i==0?(score[i] - 0):(score[i] - score[i-1]))/lostDays)    // 计算丢失的天数的平均增量
                    for (var ld = 0;ld<lostDays;ld++){
                        scoreFinal.push(Math.round(i==0?0+ avgIncrementValue * (ld+1):score[i-1] + avgIncrementValue * (ld+1)))  // 把丢失的天数的数据补全
                        dailyIncrementInvaildDays.push(scoreFinal.length-1)  // 记录增量数据不完整的天数位置
                        j++ // 增加一天
                    }
                }
            }
        }
        // 尾处理 。当尾巴 this.getDaysOfEvent(time[time.length-1])不为1的时候，就说明尾是有多项数据缺失
        if (score.length != 0){
            for(var i = 0;i<cutoffLastDataDays - this.getDaysOfEvent(time[time.length-1]);i++){   // 如果tracker最后一个数据日期跟score最后一个数据的日期有差异，说名是尾巴，要处理
                if (score.length == 0) break
                let avgIncrementValue = Math.round(((cutoffs[cutoffs.length-1].ep - score[score.length-1]))/(cutoffLastDataDays - this.getDaysOfEvent(time[time.length-1])))    // 计算丢失的天数的平均增量
                scoreFinal.push(Math.round(score[score.length-1] + avgIncrementValue * (i+1)))  // 把丢失的天数的数据补全
                if(cutoffLastDataDays - this.getDaysOfEvent(time[time.length-1]) > 1)dailyIncrementInvaildDays.push(scoreFinal.length-1)
                j++ // 因该是没什么用的了，还是加一下吧
            }
        }
        for (var i = 0;i<scoreFinal.length;i++){   // 计算增量
            if (i == 0){
                dailyIncrement.push(`${Math.round(scoreFinal[i]/10000)}${dailyIncrementInvaildDays.includes(i) ? '!' : ''}`)
            }
            else{
                dailyIncrement.push(`${Math.round((scoreFinal[i] - scoreFinal[i-1])/10000)}${dailyIncrementInvaildDays.includes(i) ? '!' : ''}` )
            }
        }
        return { dailyIncrement, invalidDays: dailyIncrementInvaildDays }
    }
    getYesterdayIncrementRate(){
        if (!this.cutoffs || this.cutoffs.length === 0){
            return '无数据'
        }
        let lastCutoffTime = this.cutoffs[this.cutoffs.length-1].time
        // HHWX数据源会在快要结活的时候改为每15分钟抓取一次，因此需要主动规避
        let usePrevPoint = false
        let UTCMin =  getDateByServerTimezone(lastCutoffTime, this.server).getUTCMinutes()
        let UTCHour = getDateByServerTimezone(lastCutoffTime,this.server).getUTCHours()
        let lengthLimit =2
        if (UTCMin < 3 || (UTCMin >= 25 && UTCMin <= 35)){
            lastCutoffTime = this.cutoffs[this.cutoffs.length-2].time
            usePrevPoint = true
        }
        if (UTCHour == 3 && UTCMin >= 40 && UTCMin <= 50) lengthLimit++
        let curEventDays = this.getDaysOfEvent(lastCutoffTime)
        let lastCutoffEp = this.cutoffs[this.cutoffs.length-(usePrevPoint?2:1)].ep

        // 目标时刻：最后一个数据点的UTC时分
        const dateNow = getDateByServerTimezone(lastCutoffTime, this.server)
        const targetUtcHour = dateNow.getUTCHours()
        const targetUtcMinutes = dateNow.getUTCMinutes()
        const targetMinutesOfDay = targetUtcHour * 60 + targetUtcMinutes

        // 收集 3:45 数据点（前天和昨天）
        let score:number[] = []
        let time:number[] = []
        // 收集昨天的所有数据点，用于找最近邻
        let yesterdayPoints: { ep: number, time: number }[] = []

        // 收集 3:40~3:50 UTC 窗口内的数据点，每天只保留最接近3:45的一个
        let candidatePoints: { ep: number, time: number, day: number, minutesDiff: number }[] = []
        for (const c of this.cutoffs) {
            const timestamp = normalizeTimestamp(c.time)
            const d = this.getDaysOfEvent(timestamp)
            if (d < (curEventDays-2)){
                continue
            }
            const date = getDateByServerTimezone(timestamp, this.server)
            if ((this.server == Server.cn || this.server == Server.tw || this.server == Server.jp) && date.getUTCHours() === 3 && date.getUTCMinutes() >= 40 && date.getUTCMinutes() <= 50) {
                candidatePoints.push({ ep: c.ep, time: timestamp, day: d, minutesDiff: Math.abs(date.getUTCMinutes() - 45) })
            }
            // 收集昨天的所有数据点（不管什么时分，全收）
            if (d == (curEventDays - 1)) {
                yesterdayPoints.push({ ep: c.ep, time: timestamp })
            }
        }
        // 按天去重，每天只保留最接近3:45的数据点，并按时间顺序排列
        let dayMap = new Map<number, { ep: number, time: number, minutesDiff: number }>()
        for (const p of candidatePoints) {
            const existing = dayMap.get(p.day)
            if (!existing || p.minutesDiff < existing.minutesDiff) {
                dayMap.set(p.day, { ep: p.ep, time: p.time, minutesDiff: p.minutesDiff })
            }
        }
        let sortedDays = Array.from(dayMap.keys()).sort((a, b) => a - b)
        for (const day of sortedDays) {
            const p = dayMap.get(day)!
            score.push(p.ep)
            time.push(p.time)
        }

        if (score.length < lengthLimit) return '数据缺失'
        if (yesterdayPoints.length == 0) return '数据缺失'

        // 在昨天的数据点中找最接近目标时刻的那个
        let nearestPoint = yesterdayPoints[0]
        let nearestDiff = Infinity
        for (const p of yesterdayPoints) {
            const d = getDateByServerTimezone(p.time, this.server)
            const minutesOfDay = d.getUTCHours() * 60 + d.getUTCMinutes()
            const diff = Math.abs(minutesOfDay - targetMinutesOfDay)
            if (diff < nearestDiff) {
                nearestDiff = diff
                nearestPoint = p
            }
        }

        // score[0] = 前天3:45, score[1] = 昨天3:45
        const dayBeforeYesterdayTime = time[0]
        const dayBeforeYesterdayEp = score[0]
        const yesterdayBaseTime = time[1]
        const yesterdayBaseEp = score[1]
        const yesterdayNearestTime = nearestPoint.time
        const yesterdayNearestEp = nearestPoint.ep

        // 今天的时间跨度：从昨天3:45到现在
        const todayTimeSpan = lastCutoffTime - yesterdayBaseTime
        // 昨天实际数据的时间跨度：从前天3:45到最近邻数据点
        const yesterdayTimeSpan = yesterdayNearestTime - dayBeforeYesterdayTime

        if (todayTimeSpan <= 0 || yesterdayTimeSpan <= 0) return '数据缺失'

        // 今天增量 = 最新ep - 昨天3:45的ep
        let TodaysIncrement = lastCutoffEp - yesterdayBaseEp
        // 昨天实际增量（原始时间跨度下的增量）
        let YesterdaysIncrementRaw = yesterdayNearestEp - dayBeforeYesterdayEp
        // 线性对齐：将昨天的增量按时间比例缩放到今天的等效时长
        let YesterdaysIncrement = Math.round(YesterdaysIncrementRaw * (todayTimeSpan / yesterdayTimeSpan))

        let rate:number = YesterdaysIncrement!=0?TodaysIncrement / YesterdaysIncrement:1
        let result =  `昨天同时刻日增${Math.round((YesterdaysIncrement)/10000)} 现在是昨天的${Math.round(rate * 100)}%${rate*100>=100?'↑':'↓'}`
        return result
    }
    getChartData(setStartToZero = false): { x: Date, y: number }[] {
        if (this.isExist == false) {
            return [];
        }
        let chartData: { x: Date, y: number }[] = [];
        if (setStartToZero) {
            chartData.push({ x: new Date(0), y: 0 });
        } else {
            chartData.push({ x: new Date(this.startAt), y: 0 });
        }

        // 在访问 this.cutoffs[0].time 之前检查 this.cutoffs 是否存在且长度大于0
        let tempTime = this.cutoffs && this.cutoffs.length > 0 ? this.cutoffs[0].time : null;
        // 如果 tempTime 为 null，则后续逻辑应当考虑这种情况以避免错误

        for (let i = 0; i < this.cutoffs.length; i++) {
            const element = this.cutoffs[i];
            if (setStartToZero) {
                // 确保 tempTime 不为 null 才执行减法操作
                chartData.push({ x: tempTime ? new Date(element.time - this.startAt) : new Date(0), y: element.ep });
            } else {
                chartData.push({ x: new Date(element.time), y: element.ep });
            }
            tempTime = element.time;
        }
        return chartData;
    }

}
