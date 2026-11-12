import { drawPlayerPt } from '@/view/playerPt';
import { listToBase64 } from '@/routers/utils';
import express from 'express';
import { body } from 'express-validator';
import { middleware } from '@/routers/middleware';
import { Request, Response } from 'express';
import { UserDB } from '@/database/userDB';

const router = express.Router();

const userDB = new UserDB(
    process.env.MONGODB_URI ?? 'mongodb://localhost:27017/',
    process.env.MONGODB_DATABASE_NAME ?? 'tsugu-bangdream-bot'
);

router.post('/',
    [
        body('playerId').isInt(), // Validation for 'playerId' field
        body('useEasyBG').isBoolean(), // Validation for 'useEasyBG' field
        body('compress').optional().isBoolean(),
        body('platform').isString(),
        body('userId').isString(),
    ],
    middleware,
    async (req: Request, res: Response) => {
        const { playerId, useEasyBG, compress, platform, userId } = req.body;

        try {
            // 本人凭据 (B站扫码获得) 按用户存储在数据库中
            const user = await userDB.getUser(platform, userId);
            const channelUid = user?.channelUid ?? '';
            const channelToken = user?.channelToken ?? '';
            if (!channelUid || !channelToken) {
                res.send(listToBase64(['错误: 尚未设置令牌, 请先添加我为好友, 再私信我发送 设置令牌 扫码完成配置']));
                return;
            }
            const result = await drawPlayerPt(playerId, useEasyBG, compress, { channelUid, channelToken }, user?.tokenPlatform || undefined);
            // tracker 未存平台时会自动探测并在响应中回传, 写回数据库供下次显式传入跳过探测
            if (result.platform && result.platform != user?.tokenPlatform) {
                try {
                    await userDB.updateUser(platform, userId, { tokenPlatform: result.platform });
                }
                catch (e) {
                }
            }
            res.send(listToBase64(result.result));
        } catch (e) {
            res.status(500).send({ status: 'failed', data: '内部错误' });
        }
    }
);

export { router as playerPtRouter }
