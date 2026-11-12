import { Config } from '../config'
import { Room } from '../types/Room'
import { getReplyFromBackend } from "../api/getReplyFromBackend"
import { API_TIMEOUT } from "../api/axiosTimeout"

import * as axios from 'axios'


export async function commandRoomList(config: Config, keyWord?: string): Promise<Array<string | Buffer>> {
    let tempRoomList: Room[] = []
    //从远程服务器获取房间列表
    const res = await axios.default.get(`${config.backendUrl}/station/queryAllRoom`, { timeout: API_TIMEOUT })
    if (res.data.status == 'success') {
        tempRoomList = res.data.data
    }
    else {
        return [`从远程服务器获取房间列表失败`]
    }
    if (tempRoomList.length == 0) {
        return ['myc']
    }
    let roomList: Room[] = []
    //关键词优先按正则表达式匹配, 无效正则回退为普通子串匹配
    let keyWordRegExp: RegExp | undefined
    if (keyWord != undefined) {
        try {
            keyWordRegExp = new RegExp(keyWord)
        }
        catch (e) {
            keyWordRegExp = undefined
        }
    }
    for (let i = 0; i < tempRoomList.length; i++) {
        const room = tempRoomList[i]
        if (keyWord != undefined) {
            const matched = keyWordRegExp != undefined ? keyWordRegExp.test(room.rawMessage) : room.rawMessage.includes(keyWord)
            if (!matched) {
                continue
            }
        }
        roomList.push(room)
    }
    if (roomList.length == 0 && keyWord != undefined) {
        return [`没有找到匹配 ${keyWord} 的房间`]
    }
    return await getReplyFromBackend(`${config.backendUrl}/roomList`, {
        roomList,
        compress: config.compress
    })
}
