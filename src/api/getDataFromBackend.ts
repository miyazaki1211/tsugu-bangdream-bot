import * as axios from 'axios';
import { Logger } from 'koishi'
import { API_TIMEOUT } from './axiosTimeout'
export const getDataFromBackendLogger = new Logger('tsugu-getDataFromBackend');

export async function getDataFromBackend(url: string, data: Object): Promise<object> {
    getDataFromBackendLogger.info(url, data)
    let result
    try {
        result = await axios.default.post(url, data, { timeout: API_TIMEOUT })
    } catch (error) {
        //连接层失败或后端返回错误状态时, 按约定返回空对象, 由调用方按"无结果"处理
        if (axios.default.isAxiosError(error)) {
            getDataFromBackendLogger.error('Axios Error:', error.message)
        }
        else {
            getDataFromBackendLogger.error(error)
        }
        return {};
    }
    if (result?.data?.status != 'success') {
        return {};
    }
    //console.log(result.data.data)
    return result.data.data;
}