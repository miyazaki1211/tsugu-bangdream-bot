import * as path from 'path';
import { Server } from '@/types/Server';
import { logger } from './logger';
import * as dotenv from 'dotenv';

dotenv.config();

export const projectRoot: string = path.resolve(path.dirname(__dirname));
export const assetsRootPath: string = path.join(projectRoot, '/assets');
export const configPath: string = path.join(projectRoot, '/config');
export const fuzzySearchPath = path.join(configPath, '/fuzzy_search_settings.json');
export const carKeywordPath = path.join(configPath, '/car_keyword.json');
export const cacheRootPath: string = path.join(projectRoot, '/cache');

export const BestdoriapiPath = { //Bestdori网站的列表api路径
    'cards': '/api/cards/all.5.json',
    'characters': '/api/characters/main.3.json',
    'bands': '/api/bands/main.1.json',
    'singer': '/api/bands/all.1.json',
    'skills': '/api/skills/all.10.json',
    'costumes': '/api/costumes/all.5.json',
    'events': '/api/events/all.6.json',
    'degrees': '/api/degrees/all.3.json',
    'gacha': '/api/gacha/all.5.json',
    'songs': '/api/songs/all.7.json',
    'meta': '/api/songs/meta/all.5.json',
    'loginCampaigns': '/api/loginCampaigns/all.5.json',
    'miracleTicketExchanges': '/api/miracleTicketExchanges/all.5.json',
    'comics': '/api/comics/all.5.json',
    'areaItems': '/api/areaItems/main.5.json',
    'rates': '/api/tracker/rates.json',
    'items': '/api/misc/itemtexts.2.json',
    'deco': '/api/deco/pins.all.3.json',
    'stamps': '/api/stamps/all.2.json',
    'monthlyRanking': '/api/monthlyRanking/info.json'
}
export const bindingPlayerPromptWaitingTime: number = 5 * 60 * 10000

export const Bestdoriurl: string = 'https://bestdori.com'; //Bestdori网站的url
export const BandoriStationurl: string = 'https://api.bandoristation.com/'; //BandoriStation网站的url

export const HHWX_Url: string = 'https://hhwx.org'; //HHWX网站的url
export var USE_HHWX_SOURCE_PREFER = false;   // 是否优先使用HHWX的Tracker数据

export const STAR_VIEWER_Url: string = process.env.RANKING_API_BASE_URL || 'https://grp-speed-backend.starfreedomx.top';
export var USE_STAR_VIEWER_SOURCE_PREFER = true;   // 是否优先使用STAR_VIEWER的Tracker数据

// 本地 GarupaSpeedTracker 数据源（与 STAR_VIEWER 同一套 API 的本地部署实例，直连国服游戏服采集）
// 启动时探测一次：端口可达则将该数据源插入排名回退链最前（star_viewer 之前）；不可达则保持原有数据源顺序
// 可通过环境变量 LOCAL_RANKING_API_URL 指定地址，设为空字符串可禁用本地数据源
export const LOCAL_RANKING_API_URL: string = process.env.LOCAL_RANKING_API_URL !== undefined ? process.env.LOCAL_RANKING_API_URL.trim() : 'http://127.0.0.1:5519';
export var USE_LOCAL_RANKING_API = false;   // 本地数据源探测结果，探测成功后置为 true
export function enableLocalRankingAPI() {
    USE_LOCAL_RANKING_API = true;
}

// 压缩模式下图片输出的 JPEG 质量（0.1~1），由环境变量 IMAGE_COMPRESS_QUALITY 控制，默认 0.75
const parsedImageCompressQuality: number = parseFloat(process.env.IMAGE_COMPRESS_QUALITY || '');
export const imageCompressQuality: number = Number.isFinite(parsedImageCompressQuality) ? Math.min(Math.max(parsedImageCompressQuality, 0.1), 1) : 0.75;

// STAR_VIEWER 数据源支持的档线列表, 不在此列表中的档线(如400)将直接跳过该数据源, 回退到下一数据源
export const STAR_VIEWER_TIER_LIST: number[] = [20, 30, 40, 50, 100, 200, 300, 500, 1000, 1500, 2000, 3000, 4000, 5000, 10000, 20000, 30000, 40000, 50000, 100000];

// ===== 数据源回退链配置 =====
// 数据源key → URL映射
export const SOURCE_URL_MAP: Record<string, string> = {
    "local_gs": LOCAL_RANKING_API_URL,
    "star_viewer": STAR_VIEWER_Url,
    "bestdori": Bestdoriurl,
    "hhwx": HHWX_Url
};

// 活动档线数据源回退链（按服务器，越靠前优先级越高）
export const EVENTRANKING_TURNS: Record<string, string[]> = {
    "cn": ["star_viewer", "hhwx", "bestdori"],
    "jp": ["star_viewer", "bestdori"],
    "default": ["bestdori"]
};

// 歌榜数据源回退链（仅STAR_VIEWER有歌榜数据）
export const MUSICRANKING_TURNS: Record<string, string[]> = {
    "cn": ["star_viewer"],
    "jp": ["star_viewer"],
    "default": ["star_viewer"]
};

// 月榜数据源回退链
export const MONTHRANKING_TURNS: Record<string, string[]> = {
    "global": ["star_viewer"],
    "cn": ["star_viewer"],
    "jp": ["star_viewer"],
    "default": ["star_viewer"]
};

// 统一解析：将server和turns配置转换为 {url, name} 数组
export function resolveSourceUrls(server: string, turnsConfig: Record<string, string[]>): {url: string, name: string}[] {
    let keys = turnsConfig[server] || turnsConfig["default"] || ["bestdori"];
    // 本地 GarupaSpeedTracker 探测可用时，插入到回退链最前（star_viewer 之前）。
    // 仅对本地实例真正持有直连数据的服务器生效（cn=国服直连；global=与服务器无关的月榜索引），其余服务器保持原链路
    if (USE_LOCAL_RANKING_API && LOCAL_RANKING_API_URL && (server === 'cn' || server === 'global')) {
        keys = ['local_gs', ...keys.filter(key => key !== 'local_gs')];
    }
    return keys.map(key => ({ url: SOURCE_URL_MAP[key], name: key }));
}

const enableAutoTrackerDataSourceSwitch = true  // 是否开启数据源优先自动切换
const trackerAutoSwitchThreshold:number = 5     // 设定数据源自动切换门限，当存在5次数据源更新不及时的情况，自动切换数据源，加快访问速度
var trackerAutoSwitchFlags:number = 0
export function reportDataSourceProblem(){
    if(enableAutoTrackerDataSourceSwitch){
        if(++trackerAutoSwitchFlags > trackerAutoSwitchThreshold-1){
            USE_HHWX_SOURCE_PREFER = !USE_HHWX_SOURCE_PREFER
            logger('config.ts/reportDataSourceProblem',`Tracker数据源多次出现问题，将数据源优先切换至${USE_HHWX_SOURCE_PREFER?"HHWX":"Bestdori"}`)
            trackerAutoSwitchFlags = 0
        }
    }
}
export function clearDataSourceProblem(){
    trackerAutoSwitchFlags = 0
}

var starViewerAutoSwitchFlags:number = 0
export function reportSTAR_VIEWERDataSourceProblem(){
    if(enableAutoTrackerDataSourceSwitch){
        if(++starViewerAutoSwitchFlags > trackerAutoSwitchThreshold-1){
            USE_STAR_VIEWER_SOURCE_PREFER = !USE_STAR_VIEWER_SOURCE_PREFER
            logger('config.ts/reportSTAR_VIEWERDataSourceProblem',`Tracker数据源多次出现问题，将数据源优先切换至${USE_STAR_VIEWER_SOURCE_PREFER?"STAR_VIEWER":"Bestdori"}`)
            starViewerAutoSwitchFlags = 0
        }
    }
}
export function clearSTAR_VIEWERDataSourceProblem(){
    starViewerAutoSwitchFlags = 0
}

export const globalDefaultServer: Array<Server> = [Server.cn, Server.jp]//默认服务器列表
export const globalServerPriority: Array<Server> = [Server.cn, Server.jp, Server.tw, Server.en, Server.kr]//默认服务器优先级

export const serverNameFullList = [
    '日服',
    '国际服',
    '台服',
    '国服',
    '韩服'
]

export const tierListOfServer = {
    'jp': [20, 30, 40, 50, 100, 200, 300, 400, 500, 1000, 2000, 5000, 10000, 20000, 30000, 50000],
    'tw': [100, 500],
    'en': [50, 100, 300, 500, 1000, 2000, 2500],
    'kr': [100],
    'cn': [20, 30, 40, 50, 100, 200, 300, 400, 500, 1000, 1500, 2000, 3000, 4000, 5000, 10000, 20000, 30000, 50000]
}

export const statusName = {
    'not_start': '未开始',
    'in_progress': '进行中',
    'ended': '已结束'
}
