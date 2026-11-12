/*
 * GarupaSpeedTracker 错误响应体解析：提取具体错误信息， 透传给用户可见的回复。
 * tracker 错误契约 (GarupaSpeedTracker backend/src/router/middleware.ts):
 *   4xx: { status, message } — message 为具体原因; 422 时 message 固定为
 *        "Validation Failed", 具体原因在 details[].message (校验字段与原因)
 *   5xx: { status, message: 'Internal Server Error' } — 中间件隐藏具体原因, 不透传
 */

const MAX_MESSAGE_LENGTH = 500

// 无信息量的通用文案, 透传后视为没有具体信息
const GENERIC_MESSAGES = ['Internal Server Error', 'Validation Failed']

function meaningfulText(value: unknown): string | undefined {
    if (typeof value != 'string') {
        return undefined
    }
    const text = value.trim()
    if (text.length == 0 || GENERIC_MESSAGES.includes(text)) {
        return undefined
    }
    return text.length > MAX_MESSAGE_LENGTH ? text.slice(0, MAX_MESSAGE_LENGTH) : text
}

/*
 * 从 tracker 的错误响应体中提取具体错误信息。
 * 响应体非对象(如纯文本网关错误)时尝试按字符串提取; 无具体信息时返回 undefined。
 */
export function extractTrackerErrorMessage(responseData: unknown): string | undefined {
    if (typeof responseData == 'string') {
        return meaningfulText(responseData)
    }
    if (responseData == null || typeof responseData != 'object') {
        return undefined
    }
    const body = responseData as { message?: unknown, details?: unknown }
    // 422: 具体原因(校验失败字段等)在 details 数组, 多条用分号连接
    if (Array.isArray(body.details)) {
        const parts: string[] = []
        for (const detail of body.details) {
            const text = meaningfulText((detail as { message?: unknown })?.message)
            if (text != undefined) {
                parts.push(text)
            }
        }
        if (parts.length > 0) {
            return parts.join('; ')
        }
    }
    return meaningfulText(body.message)
}
