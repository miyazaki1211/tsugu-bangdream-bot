import { Config } from '../config'
import * as axios from 'axios'
import { ROOM_QUERY_TIMEOUT } from '../api/axiosTimeout'

//GarupaSpeedTracker后端 GET /api/rooms/{roomNumber}/players 的响应结构
interface RoomPlayersApiResult {
    roomNumber: number,
    roomOpenId: string,
    name: string,
    maxPlayers: number,
    masterUid: string,
    players: {
        uid: string,
        name: string,
    }[],
    fetchedAt: number,
    cached: boolean,
}

//将GarupaSpeedTracker后端的错误码翻译为用户可读的提示
function roomQueryErrorMessage(status: number, code: string): string {
    switch (code) {
        case 'INVALID_ROOM_NUMBER':
            return '错误: 房间号必须为6位数字'
        case 'ROOM_NOT_FOUND':
            return '未找到该房间, 房间可能已经解散, 或暂时无法确认房间存在, 请稍后重试'
        case 'NO_ASSOCIATION':
            return '无法查询该房间'
        case 'RATE_LIMITED':
            return '查询过于频繁, 两次查询至少需要间隔10秒, 请稍后重试'
        case 'ROOM_QUERY_DISABLED':
            return '房间查询服务未启用'
        case 'NEBULA_ERROR':
        case 'UPSTREAM_ERROR':
            return '查询房间失败: 上游服务器错误, 请稍后重试'
        default:
            return `查询房间失败: ${status}`
    }
}

export async function commandCheckRoom(config: Config, roomNumber: string): Promise<Array<string | Buffer>> {
    if (!/^\d{6}$/.test(roomNumber)) {
        return ['错误: 房间号必须为6位数字']
    }
    let result: RoomPlayersApiResult
    try {
        const res = await axios.default.get(`${config.garupaSpeedTrackerUrl}/api/rooms/${roomNumber}/players`, { timeout: ROOM_QUERY_TIMEOUT })
        result = res.data
    }
    catch (e) {
        if (axios.default.isAxiosError(e) && e.response) {
            return [roomQueryErrorMessage(e.response.status, e.response.data?.code)]
        }
        return ['查询房间失败: 无法连接到房间查询服务, 请检查 GarupaSpeedTracker 后端是否正在运行']
    }
    const playerList = result.players.map((player, index) => {
        const isMaster = player.uid === result.masterUid
        return `${index + 1}. ${player.name} (${player.uid})${isMaster ? ' [房主]' : ''}`
    })
    if (playerList.length == 0) {
        return ['房间内暂无玩家']
    }
    return [playerList.join('\n')]
}
