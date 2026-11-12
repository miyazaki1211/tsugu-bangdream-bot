import * as fs from 'fs'
import { carKeywordPath, tsuguUser, Config } from "../config";
import { Session } from 'koishi'
import * as axios from 'axios'
import { API_TIMEOUT } from "../api/axiosTimeout";

interface CarKeyword {
    [type: string]: string[];
}

function loadConfig(): CarKeyword {
    const fileContent = fs.readFileSync(carKeywordPath, 'utf-8');
    return JSON.parse(fileContent);
}

const carKeywordConfig = loadConfig();

export async function roomNumber(config: Config, session: Session, user: tsuguUser, number: number, raw_message: string) {
    if (!user.shareRoomNumber) {
        return
    }
    // 提取车牌号后面的内容，关键词仅匹配内容部分，避免数字部分误匹配
    const content = raw_message.replace(/^\d{5,6}/, '').toLowerCase()
    let isCar = false
    for (let i = 0; i < carKeywordConfig['car'].length; i++) {
        const element = carKeywordConfig['car'][i];
        if (content.indexOf(element.toLowerCase()) != -1) {
            isCar = true
        }
    }
    for (let i = 0; i < carKeywordConfig['fake'].length; i++) {
        const element = carKeywordConfig['fake'][i];
        if (content.indexOf(element.toLowerCase()) != -1) {
            isCar = false
        }
    }
    if (isCar) {
        await axios.default.post(`${config.backendUrl}/station/submitRoomNumber`, {
            number: number,
            rawMessage: raw_message,
            platform: user.platform,
            userId: user.userId,
            userName: session.username,
            time: Date.now(),
            avatarUrl: session.event.user.avatar,
            bandoriStationToken: config.bandoriStationToken
        }, { timeout: API_TIMEOUT })
    }
}

