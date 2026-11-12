import axios, { AxiosResponse, AxiosError } from 'axios';
import { Logger } from 'koishi'
import { RENDER_TIMEOUT } from './axiosTimeout'
export const getReplyFromBackendLogger = new Logger('tsugu-getReplyFromBackend');

function base64ToList(basd64List: Array<{ type: 'string' | 'base64', string: string }>): Array<Buffer | string> {
    const result: Array<Buffer | string> = []
    for (let i = 0; i < basd64List.length; i++) {
        const element = basd64List[i];
        if (element.type == 'string') {
            result.push(element.string)
        }
        else if (element.type == 'base64') {
            result.push(Buffer.from(element.string, 'base64'))
        }
    }
    return result
}

async function sendPostRequest(url: string, data: any): Promise<Object> {
    try {
        const response: AxiosResponse = await axios.post(url, data, { timeout: RENDER_TIMEOUT });
        const result: any = response.data as Object;
        switch (response.status) {
            case 200:
                // 将下载的 JSON 文件转换为对象
                return result;
            case 400:
                return [{
                    type: 'string',
                    string: `错误: 请求参数错误, 可能是版本与后端不一致`
                }];
            case 404:
                return [{
                    type: 'string',
                    string: `错误: 无法连接至后端服务器`
                }];
            case 422:
                return [{
                    type: 'string',
                    string: `错误: 无效的请求 (${result})`
                }];
            case 500:
                return [{
                    type: 'string',
                    string: `内部错误`
                }];
            default:
                return [{
                    type: 'string',
                    string: `错误: 未知错误`
                }];
        }
    } catch (error) {
        // 在此处处理错误
        if (axios.isAxiosError(error)) {
            // 处理由 Axios 抛出的错误
            console.error('Axios Error:', error.message);
            if (error.response) {
                // 后端返回了错误响应: 优先透传后端返回的错误文案(如参数校验失败)
                const responseData = error.response.data as any;
                const backendMessage: unknown = responseData?.data;
                if (typeof backendMessage == 'string' && backendMessage.length > 0) {
                    const text = (backendMessage.startsWith('错误') || backendMessage.startsWith('内部错误')) ? backendMessage : `错误: ${backendMessage}`;
                    return [{ type: 'string', string: text }];
                }
                switch (error.response.status) {
                    case 400:
                        return [{
                            type: 'string',
                            string: `错误: 请求参数错误, 可能是版本与后端不一致`
                        }];
                    case 404:
                        return [{
                            type: 'string',
                            string: `错误: 无法连接至后端服务器`
                        }];
                    case 500:
                        return [{
                            type: 'string',
                            string: `内部错误`
                        }];
                    default:
                        return [{
                            type: 'string',
                            string: `错误: 后端服务器返回异常状态 (${error.response.status})`
                        }];
                }
            }
            // 未收到响应: 连接层错误, 区分超时与其他连接问题
            if (error.code == 'ECONNABORTED' || error.code == 'ETIMEDOUT') {
                return [{
                    type: 'string',
                    string: '错误: 后端服务器响应超时, 请稍后重试'
                }];
            }
            return [{
                type: 'string',
                string: '错误: 后端服务器连接出错'
            }];
        } else {
            // 处理其他错误
            console.error('Error:', error.message);
        }
        return [{
            type: 'string',
            string: '内部错误'
        }];
    }
}

export async function getReplyFromBackend(url: string, data: any): Promise<Array<Buffer | string>> {
    getReplyFromBackendLogger.info(url, data)
    const result: any = await sendPostRequest(url, data);
    return base64ToList(result)
}