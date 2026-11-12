import { getDataFromBackend } from "../api/getDataFromBackend"
import { getReplyFromBackend } from "../api/getReplyFromBackend"
import { Config } from '../config'
import { Session } from 'koishi'
import { paresMessageList } from '../utils'

/*
 * 设置令牌: 通过哔哩哔哩APP扫码登录获取本人渠道凭据 (channelUid/channelToken),
 * 按用户存储在后端数据库中, 供 导入全部配置 和 查PT 指令使用。
 * 发送 `设置令牌 删除` 可清除已保存的凭据。
 * 出于账号安全考虑, 该指令仅可在私聊中使用。
 */

//轮询间隔与总时长 (B站二维码有效期 180 秒, 留 10 秒余量)
const QR_POLL_INTERVAL_MS = 2500
const QR_POLL_TOTAL_MS = 190000

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))

//扫码登录主流程: 申请二维码 → 推送图片 → 轮询至成功/过期
export async function commandSetToken(config: Config, session: Session): Promise<Array<Buffer | string>> {
    const start = await getDataFromBackend(`${config.backendUrl}/user/qrcodeLogin/start`, {
        platform: session.platform,
        userId: session.userId,
    }) as { qrBase64?: string, expiresIn?: number, gen?: number }
    if (typeof start.qrBase64 != 'string' || start.qrBase64.length == 0) {
        return ['错误: 获取登录二维码失败, 请稍后重试']
    }
    await session.send(paresMessageList([
        Buffer.from(start.qrBase64, 'base64'),
        '请使用哔哩哔哩APP扫码, 并在手机上确认登录。\n二维码5分钟内有效, 请勿截图分享给他人。',
    ]))
    let scannedTipSent = false
    const deadline = Date.now() + QR_POLL_TOTAL_MS
    while (Date.now() < deadline) {
        await sleep(QR_POLL_INTERVAL_MS)
        const poll = await getDataFromBackend(`${config.backendUrl}/user/qrcodeLogin/poll`, {
            platform: session.platform,
            userId: session.userId,
            gen: start.gen,
        }) as { state?: string, channelUid?: string }
        if (poll.state == 'success') {
            return [`令牌设置成功 (B站UID: ${poll.channelUid ?? '未知'})\n已可使用 查pt/查歌榜/导入全部配置 指令。注意：此类指令会使游戏掉线一次`]
        }
        if (poll.state == 'expired') {
            return ['二维码已过期, 请重新发送 设置令牌 获取']
        }
        if (poll.state == 'scanned' && !scannedTipSent) {
            scannedTipSent = true
            await session.send('已扫码, 请在手机上确认登录')
        }
    }
    return ['二维码已过期, 请重新发送 设置令牌 获取']
}

//删除令牌 (清空 channelUid/channelToken)
export async function commandSetTokenDelete(config: Config, session: Session): Promise<Array<Buffer | string>> {
    return await getReplyFromBackend(`${config.backendUrl}/user/qrcodeLogin/delete`, {
        platform: session.platform,
        userId: session.userId,
    })
}
