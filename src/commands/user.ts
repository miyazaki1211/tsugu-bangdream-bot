import { Session, h } from "koishi";
import { Server, getServerByName } from "../types/Server";
import { tsuguUser, bindingPlayerPromptWaitingTime, serverNameFullList, Config, userPlayerInList, getUserPlayerByUser } from "../config";
import { commandSearchPlayer } from "./searchPlayer";
import { paresMessageList } from '../utils';
import { getRemoteDBUserData, changeUserData, bindPlayerRequest, bindPlayerVerify } from '../api/remoteDB';

export async function getUser(session: Session, config: Config): Promise<tsuguUser> {
    const tempData = await getRemoteDBUserData(config.backendUrl, session.platform, session.userId)
    if (tempData?.status != 'success') {
        throw new Error(tempData?.data as string)
    }
    return tempData.data as tsuguUser
}

// 绑定玩家
export async function commandBindPlayer(config: Config, session: Session, server: Server) {
    let user: tsuguUser
    try {
        user = await getUser(session, config)
    } catch (error) {
        return error.message
    }

    // 从远程服务器获取验证码
    const requestResult = await bindPlayerRequest(config.backendUrl, session.platform, session.userId)
    if (requestResult.status != 'success') {
        return (requestResult.data as string)
    }
    const tempID = (requestResult.data as { verifyCode: number }).verifyCode

    await session.send(`正在绑定来自 ${serverNameFullList[server]} 账号，请将你的\n评论(个性签名)\n或者\n你的当前使用的卡组的卡组名(乐队编队名称)\n改为以下数字后，直接发送你的玩家id\n${tempID}`)

    // 等待下一步录入
    const input = await session.prompt(bindingPlayerPromptWaitingTime)

    // 处理input，检测是否为数字
    // prompt超时
    if (!input) {
        return '错误: 等待超时'
    }

    const playerId = parseInt(input)

    if (Number.isNaN(playerId)) {
        return '错误: 无效的玩家id'
    }

    // 验证玩家信息
    const verifyResult = await bindPlayerVerify(config.backendUrl, session.platform, session.userId, server, playerId, 'bind')
    if (verifyResult.status != 'success') {
        return (verifyResult.data as string)
    }
    // 绑定成功，生成玩家状态图片
    session.send(`绑定 ${serverNameFullList[server]} 玩家 ${playerId} 成功, 正在生成玩家状态图片`)
    user.platform = session.platform
    user.userId = session.userId
    const result = paresMessageList(await commandSearchPlayer(config, playerId, server))
    return result
}

// 解绑玩家，需要验证
export async function commandUnbindPlayer(config: Config, session: Session, server: Server, index?: number) {
    let user: tsuguUser
    try {
        user = await getUser(session, config)
    } catch (error) {
        return error.message
    }
    let playerInList: userPlayerInList
    try {
        playerInList = getUserPlayerByUser(user, server)
    }
    catch (e) {
        return e.message
    }

    const playerId = playerInList.playerId

    // 从远程服务器获取验证码
    const requestResult = await bindPlayerRequest(config.backendUrl, session.platform, session.userId)
    if (requestResult.status != 'success') {
        return (requestResult.data as string)
    }
    const tempID = (requestResult.data as { verifyCode: number }).verifyCode

    await session.send(`正在解除绑定绑定来自 ${serverNameFullList[server]} 账号 玩家ID: ${playerId}，请将你的\n评论(个性签名)\n或者\n你的当前使用的卡组的卡组名(乐队编队名称)\n改为以下数字后，发送任意消息继续\n${tempID}`)

    // 等待下一步录入
    const input = await session.prompt(bindingPlayerPromptWaitingTime)

    if (!input) {
        return '错误: 等待超时'
    }

    // 验证玩家信息
    const verifyResult = await bindPlayerVerify(config.backendUrl, session.platform, session.userId, server, playerId, 'unbind')
    if (verifyResult.status != 'success') {
        return (verifyResult.data as string)
    }
    session.send(`解除绑定 ${serverNameFullList[server]} 玩家ID: ${playerId} 成功`)
    user.platform = session.platform
    user.userId = session.userId
    return
}

// 玩家状态
export async function commandPlayerInfo(config: Config, session: Session, index?: number) {
    let user: tsuguUser
    try {
        user = await getUser(session, config)
    } catch (error) {
        return error.message
    }
    let playerInList: userPlayerInList
    if (user.userPlayerList.length == 0) {
        return '未绑定任何玩家'
    }

    if (index != undefined) {
        if (index > user.userPlayerList.length || index < 1) {
            return '错误: 无效的绑定信息ID'
        }
        playerInList = user.userPlayerList[index - 1]
    }
    else {
        try {
            playerInList = getUserPlayerByUser(user, user.mainServer)
        }
        catch (e) {
            return e.message
        }
    }
    const result = paresMessageList(await commandSearchPlayer(config, playerInList.playerId, playerInList.server))
    return result
}

// 玩家绑定信息列表
export async function commandPlayerList(config: Config, session: Session) {
    let user: tsuguUser
    let result = ''
    try {
        user = await getUser(session, config)
    } catch (error) {
        return error.message
    }
    if (user.userPlayerList.length == 0) {
        result += '未绑定任何玩家\n'
    }
    else {
        result += '已绑定玩家列表:\n'
        for (let i = 0; i < user.userPlayerList.length; i++) {
            const playerInList = user.userPlayerList[i]
            result += `${i + 1}. ${serverNameFullList[playerInList.server]}: ${playerInList.playerId}\n`
        }
        result += `当前默认玩家绑定信息ID: ${user.userPlayerIndex + 1}\n`
    }
    result += `当前主服务器: ${serverNameFullList[user.mainServer]}\n`
    result += `默认显示服务器顺序: ${user.displayedServerList.map(s => serverNameFullList[s]).join(", ")}\n`
    return result
}

// 切换玩家绑定信息ID
export async function commandSwitchPlayerIndex(config: Config, session: Session, index: number) {
    let user: tsuguUser
    try {
        user = await getUser(session, config)
    } catch (error) {
        return error.message
    }
    if (user.userPlayerList.length == 0) {
        return '错误: 未绑定任何玩家, 请发送[绑定玩家]开始绑定'
    }
    if (index < 1 || index > user.userPlayerList.length) {
        return '错误: 无效的绑定信息ID'
    }
    user.userPlayerIndex = index - 1
    const tempData = await changeUserData(config.backendUrl, session.platform, session.userId, { userPlayerIndex: user.userPlayerIndex })
    if (tempData.status != 'success') {
        return (tempData.data as string)
    }
    return `已切换至绑定信息ID: ${index}`
}

export async function commandSwitchServerMode(config: Config, session: Session, server: Server) {
    let user: tsuguUser
    try {
        user = await getUser(session, config)
    } catch (error) {
        return error.message
    }

    const tempData = await changeUserData(config.backendUrl, session.platform, session.userId, { mainServer: server })
    if (tempData.status != 'success') {
        return (tempData.data as string)
    }
    user.mainServer = server
    return `已切换到${serverNameFullList[server]}模式`
}

export async function commandSwitchDisplayedServerList(config: Config, session: Session, serverName: string[]) {

    const servers = serverName.map(s => getServerByName(s))
    if (new Set(servers).size != servers.length) {
        return '错误: 指定了重复的服务器'
    }
    if (servers.length == 0) {
        return '错误: 请指定至少一个服务器'
    }
    if (servers.includes(undefined)) {
        return '错误: 指定了不存在的服务器'
    }
    else {

        let user: tsuguUser
        try {
            user = await getUser(session, config)
        } catch (error) {
            return error.message
        }

        const tempData = await changeUserData(config.backendUrl, session.platform, session.userId, { displayedServerList: servers })
        if (tempData.status != 'success') {
            return (tempData.data as string)
        }
        user.displayedServerList = servers
        return `成功切换默认显示服务器顺序: ${servers.map(s => serverNameFullList[s]).join(", ")}`
    }
}

export async function commandSwitchShareRoomNumberMode(config: Config, session: Session, mode: boolean) {
    if (mode == undefined) {
        return '错误: 未知的车辆模式'
    }

    let user: tsuguUser
    try {
        user = await getUser(session, config)
    } catch (error) {
        return error.message
    }

    const tempData = await changeUserData(config.backendUrl, session.platform, session.userId, { shareRoomNumber: mode })
    if (tempData.status != 'success') {
        return (tempData.data as string)
    }
    user.shareRoomNumber = mode
    return `已${mode ? '开启' : '关闭'}用户 ${session.username} 的车牌自动转发`
}