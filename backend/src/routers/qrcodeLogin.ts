import express, { Request, Response } from 'express';
import { body } from 'express-validator';
import QRCode from 'qrcode';
import { UserDB } from '@/database/userDB';
import { middleware } from '@/routers/middleware';
import { requestBiliQrAuthCode, pollBiliQrLogin, BiliQrPollState } from '@/api/bilibiliQrLogin';
import { listToBase64 } from '@/routers/utils';
import { logger } from '@/logger';

/*
 * B站扫码登录（设置令牌）：
 * POST /user/qrcodeLogin/start  申请二维码 → { qrBase64(PNG), expiresIn(秒), gen }
 * POST /user/qrcodeLogin/poll   轮询扫码状态 → { state: pending|scanned|success|expired, channelUid? }
 *
 * 任务表为进程内存 Map（PM2 fork 单实例部署，跨实例需外置存储）。
 * 扫码成功时凭据直接落 userDB（channelUid/channelToken），插件只收到 state 与 channelUid。
 * 本路由挂载于 /user/qrcodeLogin，与 /user 同受 LOCAL_DB 开关控制（见 app.ts）。
 */

const router = express.Router();

let userDB: UserDB;
if (process.env.LOCAL_DB == 'true') {
    userDB = new UserDB(process.env.MONGODB_URI, process.env.MONGODB_DATABASE_NAME);
}

interface QrLoginTask {
    authCode: string;
    gen: number;
    createdAt: number;
    lastBiliPollAt: number;
    /** 最近一次对B站真实轮询得到的状态（限速窗口内复用） */
    lastState: BiliQrPollState;
}

//key = `${platform}:${userId}`（与 userDB.getKey 不同, 这里不做 onebot→red 归一, 仅作任务键）
const tasks = new Map<string, QrLoginTask>();
const lastStartAt = new Map<string, number>();
let genCounter = 0;

const BILI_QR_EXPIRES_IN = 180;
/** 与B站有效期(180s)相比留 5s 网络余量 */
const TASK_TTL_MS = (BILI_QR_EXPIRES_IN + 5) * 1000;
/** start 冷却, 防刷二维码 */
const START_COOLDOWN_MS = 10000;
/** 对B站真实轮询的最小间隔, 防止 -412 请求过频 */
const BILI_POLL_MIN_INTERVAL_MS = 1500;

function cleanupTasks(): void {
    const now = Date.now();
    for (const [key, task] of tasks) {
        if (now - task.createdAt > TASK_TTL_MS) {
            tasks.delete(key);
        }
    }
    if (lastStartAt.size > 10000) {
        lastStartAt.clear();
    }
}

// 申请二维码
router.post('/start',
    [
        body('platform').isString(),
        body('userId').isString(),
    ],
    middleware,
    async (req: Request, res: Response) => {
        const { platform, userId } = req.body;
        const key = `${platform}:${userId}`;
        cleanupTasks();
        const last = lastStartAt.get(key) ?? 0;
        if (Date.now() - last < START_COOLDOWN_MS) {
            res.status(429).json({ status: 'failed', data: '错误: 操作过于频繁, 请稍后再试' });
            return;
        }
        try {
            const auth = await requestBiliQrAuthCode();
            const qrBuffer = await QRCode.toBuffer(auth.url, { type: 'png', width: 512, margin: 2 });
            lastStartAt.set(key, Date.now());
            const gen = ++genCounter;
            tasks.set(key, { authCode: auth.authCode, gen, createdAt: Date.now(), lastBiliPollAt: 0, lastState: 'pending' });
            res.json({ status: 'success', data: { qrBase64: qrBuffer.toString('base64'), expiresIn: BILI_QR_EXPIRES_IN, gen } });
        }
        catch (e) {
            logger('qrcodeLogin', `获取B站二维码失败: ${e.message}`);
            res.status(500).json({ status: 'failed', data: '错误: 获取登录二维码失败, 请稍后重试' });
        }
    }
);

// 轮询扫码状态
router.post('/poll',
    [
        body('platform').isString(),
        body('userId').isString(),
        body('gen').isInt(),
    ],
    middleware,
    async (req: Request, res: Response) => {
        const { platform, userId } = req.body;
        const gen: number = Number(req.body.gen);
        const key = `${platform}:${userId}`;
        const task = tasks.get(key);
        //无任务或代数不匹配(用户已重新发起) → 视为过期, 让旧轮询环退出
        if (task == undefined || task.gen != gen) {
            res.json({ status: 'success', data: { state: 'expired' } });
            return;
        }
        const now = Date.now();
        if (now - task.createdAt > TASK_TTL_MS) {
            tasks.delete(key);
            res.json({ status: 'success', data: { state: 'expired' } });
            return;
        }
        //对B站限速: 距上次真实轮询不足间隔时, 直接返回上次状态
        if (now - task.lastBiliPollAt < BILI_POLL_MIN_INTERVAL_MS) {
            res.json({ status: 'success', data: { state: task.lastState } });
            return;
        }
        task.lastBiliPollAt = now;
        let result;
        try {
            result = await pollBiliQrLogin(task.authCode);
        }
        catch (e) {
            //网络异常视为未完成, 任务保留待下次轮询重试
            logger('qrcodeLogin', `轮询B站扫码状态失败: ${e.message}`);
            res.json({ status: 'success', data: { state: task.lastState } });
            return;
        }
        if (result.state == 'pending' || result.state == 'scanned') {
            task.lastState = result.state;
        }
        if (result.state == 'success') {
            try {
                let user = await userDB.getUser(platform, userId);
                if (user == null) {
                    await userDB.createUser(platform, userId);
                }
                await userDB.updateUser(platform, userId, {
                    channelUid: result.channelUid,
                    channelToken: result.channelToken,
                });
            }
            catch (e) {
                logger('qrcodeLogin', `扫码凭据写入数据库失败: ${e.message}`);
                res.status(500).json({ status: 'failed', data: '错误: 凭据保存失败, 请重试' });
                return;
            }
            tasks.delete(key);
            res.json({ status: 'success', data: { state: 'success', channelUid: result.channelUid } });
            return;
        }
        if (result.state == 'expired') {
            tasks.delete(key);
        }
        res.json({ status: 'success', data: { state: result.state } });
    }
);

// 删除本人凭据 (设置令牌 删除)
router.post('/delete',
    [
        body('platform').isString(),
        body('userId').isString(),
    ],
    middleware,
    async (req: Request, res: Response) => {
        const { platform, userId } = req.body;
        try {
            let user = await userDB.getUser(platform, userId);
            if (user == null) {
                await userDB.createUser(platform, userId);
            }
            await userDB.updateUser(platform, userId, { channelUid: '', channelToken: '', tokenPlatform: '' });
            res.send(listToBase64(['令牌已删除']));
        }
        catch (e) {
            logger('qrcodeLogin', `删除凭据失败: ${e.message}`);
            res.status(500).json({ status: 'failed', data: `错误: ${e.message}` });
        }
    }
);

export { router as qrcodeLoginRouter }
