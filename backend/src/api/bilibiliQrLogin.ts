import { createHash } from 'crypto';
import axios from 'axios';

/*
 * 哔哩哔哩 TV 端扫码登录协议（云视听小电视 appkey）。
 * 流程：① auth_code 申请二维码（有效期 180 秒）→ ② 用户扫码并在手机确认 → ③ poll 轮询取得 mid/access_token。
 * access_token 只下发给发起方（本后端），插件与前端不会接触凭据明文。
 * 协议参考：bilibili-API-collect（pskdje 镜像）docs/login/login_action/QR.md、docs/misc/sign/APP.md；
 * 签名算法已用官方文档示例向量实测验证。
 */

const BILI_PASSPORT_HOST = 'https://passport.bilibili.com';
const BILI_TV_APPKEY = '4409e2ce8ffd12b8';
const BILI_TV_APPSEC = '59b43e04ad6965f34319062b478f83dd';

const BILI_REQUEST_TIMEOUT = 10000;

/** TV 端接口签名：参数按 key 排序 URLSearchParams 序列化后拼接 appsec，取 MD5（32位小写hex） */
function appSign(params: Record<string, string>): string {
    const search = new URLSearchParams({ ...params, appkey: BILI_TV_APPKEY });
    search.sort();
    return createHash('md5').update(search.toString() + BILI_TV_APPSEC).digest('hex');
}

/** 组装 TV 端 POST form 表单（appkey/local_id/ts/sign） */
function buildBiliForm(params: Record<string, string>): URLSearchParams {
    return new URLSearchParams({ ...params, appkey: BILI_TV_APPKEY, sign: appSign(params) });
}

export interface BiliQrAuthCode {
    /** 二维码内容（H5 确认页地址） */
    url: string;
    /** 轮询凭证（32 字符） */
    authCode: string;
}

/** ① 申请扫码登录二维码（有效期 180 秒） */
export async function requestBiliQrAuthCode(): Promise<BiliQrAuthCode> {
    const params = { local_id: '0', ts: String(Math.floor(Date.now() / 1000)) };
    const response = await axios.post(
        `${BILI_PASSPORT_HOST}/x/passport-tv-login/qrcode/auth_code`,
        buildBiliForm(params),
        { timeout: BILI_REQUEST_TIMEOUT }
    );
    const payload = response.data;
    if (payload?.code != 0) {
        throw new Error(`B站二维码申请失败 (code ${payload?.code}: ${payload?.message ?? '未知错误'})`);
    }
    const url: unknown = payload?.data?.url;
    const authCode: unknown = payload?.data?.auth_code;
    if (typeof url != 'string' || url.length == 0 || typeof authCode != 'string' || authCode.length == 0) {
        throw new Error('B站二维码申请响应缺少 url/auth_code 字段');
    }
    return { url, authCode };
}

export type BiliQrPollState = 'pending' | 'scanned' | 'success' | 'expired';

export interface BiliQrPollResult {
    state: BiliQrPollState;
    /** state=success 时返回：B站用户 mid */
    channelUid?: string;
    /** state=success 时返回：access_token */
    channelToken?: string;
}

/** ③ 轮询扫码结果：86039=未扫码 86090=已扫码未确认 0=成功 86038/-4xx/-3=终态失效 */
export async function pollBiliQrLogin(authCode: string): Promise<BiliQrPollResult> {
    const params = { auth_code: authCode, local_id: '0', ts: String(Math.floor(Date.now() / 1000)) };
    const response = await axios.post(
        `${BILI_PASSPORT_HOST}/x/passport-tv-login/qrcode/poll`,
        buildBiliForm(params),
        { timeout: BILI_REQUEST_TIMEOUT }
    );
    const payload = response.data;
    const code: number = payload?.code;
    switch (code) {
        case 0: {
            const mid: unknown = payload?.data?.mid;
            const accessToken: unknown = payload?.data?.access_token;
            if (mid == undefined || typeof accessToken != 'string' || accessToken.length == 0) {
                throw new Error('B站扫码响应缺少 mid/access_token 字段');
            }
            return { state: 'success', channelUid: String(mid), channelToken: accessToken };
        }
        case 86039:
            return { state: 'pending' };
        case 86090:
            return { state: 'scanned' };
        default:
            // 86038 二维码已失效；-404/-400/-3 请求错误 — 均为终态
            return { state: 'expired' };
    }
}
