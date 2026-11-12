import { Context, Schema, h, Session, Command, Logger } from 'koishi'
import { commandCard } from './commands/searchCard'
import { commandEvent } from './commands/searchEvent'
import { commandSong } from './commands/searchSong'
import { commandGacha } from './commands/searchGacha'
import { commandCutoffDetail } from './commands/cutoffDetail'
import { commandSearchPlayer } from './commands/searchPlayer'
import { commandPlayerPt } from './commands/playerPt'
import { commandPlayerMusic } from './commands/playerMusic'
import { commandSetToken, commandSetTokenDelete } from './commands/setToken'
import { commandCutoffListOfRecentEvent } from './commands/cutoffListOfRecentEvent'
import { commandCutoffAll } from './commands/cutoffAll'
import { commandGachaSimulate } from './commands/gachaSimulate'
import { commandGetCardIllustration } from './commands/getCardIllustration'
import { commandCharacter } from './commands/searchCharacter'
import { commandSongMeta } from './commands/songMeta'
import { roomNumber } from './commands/roomNumber'
import { commandRoomList } from './commands/roomList'
import { commandCheckRoom } from './commands/checkRoom'
import { commandBindPlayer, commandPlayerInfo, commandSwitchDisplayedServerList, commandSwitchServerMode, commandUnbindPlayer, commandSwitchShareRoomNumberMode, commandPlayerList, commandSwitchPlayerIndex } from './commands/user'
import { commandSongChart, commandCommunitySongChart } from './commands/songChart'
import { commandEventStage } from './commands/eventStage'
import { commandCalendar } from './commands/calendar'
import { commandSongRandom } from './commands/songRandom'
import { commandTopRateDetail } from './commands/topRateDetail'
import { commandTopRateRanking } from './commands/topRateRanking'
import { commandTopTenMinuteSpeed } from './commands/topTenMinuteSpeed'
import { commandTopPointStat } from './commands/topPointStat'
import { commandMonthlyTopRateRanking } from './commands/monthlyTopRateRanking'
import { commandMonthlyTopTenMinuteSpeed } from './commands/monthlyTopTenMinuteSpeed'
import { commandMonthlyTopPointStat } from './commands/monthlyTopPointStat'
import { commandMonthlyTopRateDetail } from './commands/monthlyTopRateDetail'
import { commandMonthlyRankingCutoffDetail } from './commands/monthlyRankingCutoffDetail'
import { commandMonthlyRankingCutoffAll } from './commands/monthlyRankingCutoffAll'
import { commandMonthlyRankingCutoffListOfRecent } from './commands/monthlyRankingCutoffListOfRecent'
import { commandMonthlyRanking } from './commands/searchMonthlyRanking'
import { commandCutOffMusic } from './commands/cutOffMusic'
import { commandEventBorderPlayers, commandMusicBorderPlayers, commandMonthlyBorderPlayers } from './commands/borderPlayers'
import { commandFinalRankingSubmit, commandFinalRankingQuery, commandFinalRankingDelete, getGroupName, checkGroupAdmin } from './commands/finalRanking'
import { Server } from './types/Server'
import { globalDefaultServer, tsuguUser, serverNameFullList, createDefaultTsuguUser } from './config'
import { tierListOfServerToString, checkLeftDigits, paresMessageList, parseTimeToMinutes, parseDate } from './utils'
import { getRemoteDBUserData } from './api/remoteDB'
import { serverNameFuzzySearchResult, getFuzzySearchResult } from './api/fuzzySearch'
import {} from 'koishi-plugin-adapter-onebot'
import { Player } from './types/Player'
import { isValidTier } from './commands/utils'

export const name = 'tsugu-bangdream-bot';
export const inject = ['database'];


declare module 'koishi' {
  interface Channel {
    tsugu_gacha: boolean,
    tsugu_run: boolean,
  }
}

export interface Config {
  useEasyBG: boolean,
  compress: boolean,
  bandoriStationToken: string,
  backendUrl: string,
  garupaSpeedTrackerUrl: string,

  // noSpace: boolean,
  reply: boolean,
  at: boolean,
}


export const Config = Schema.intersect([
  Schema.object({
    useEasyBG: Schema.boolean().default(false).description('是否使用简易背景, 启用这将大幅提高速度, 关闭将使部分界面效果更美观'),
    compress: Schema.boolean().default(true).description('是否压缩图片, 启用会使图片质量下降, 大幅提高速度, 体积减小从而减少图片传输时所需的时间, 关闭会提高画面清晰度'),
    bandoriStationToken: Schema.string().description('BandoriStationToken, 用于发送车牌, 可以去 https://github.com/maborosh/BandoriStation/wiki/API%E6%8E%A5%E5%8F%A3 申请。缺失情况下, 视为Tsugu车牌'),

    reply: Schema.boolean().default(false).description('消息是否回复用户'),
    at: Schema.boolean().default(false).description('消息是否@用户'),
    // noSpace: Schema.boolean().default(false).description('是否启用无需空格触发大部分指令, 启用这将方便一些用户使用习惯, 但会增加bot误判概率, 仍然建议使用空格'),

    backendUrl: Schema.string().required().description('后端服务器地址(必填), 用于处理指令与用户数据(远程独立数据库)。如果你在本机部署后端, 请写 "http://127.0.0.1:3000"'),
    garupaSpeedTrackerUrl: Schema.string().required(false).default('http://127.0.0.1:5519').description('GarupaSpeedTracker后端地址, 用于"查房间"指令, 接口为 GET /api/rooms/{房间号}/players。默认为本机部署的GarupaSpeedTracker后端'),
  }).description('Tsugu BangDream Bot 配置'),
])



export function apply(ctx: Context, config: Config) {
  // 扩展 channel 表存储群聊中的查卡开关
  ctx.model.extend("channel",
    {
      tsugu_gacha: { type: 'boolean', initial: true },
      tsugu_run: { type: 'boolean', initial: true },
    })

  //获取用户数据函数(仅使用远程独立数据库, 不再读写koishi本地用户表)
  async function observeUserTsugu(session: Session): Promise<tsuguUser> {
    const remoteResult = await getRemoteDBUserData(config.backendUrl, session.platform, session.userId)
    if (remoteResult.status == 'success') {
      return remoteResult.data as tsuguUser
    }
    //远程数据库不可用时提示错误, 并以未绑定任何玩家的默认数据继续, 由指令自身返回统一的未绑定提示
    session.send(remoteResult.data as string)
    return createDefaultTsuguUser(session.userId, session.platform)
  }

  //判断是否为车牌
  ctx.middleware(async (session, next) => {
    const number = checkLeftDigits(session.content)
    if (number != 0) {
      const tsuguUserData = await observeUserTsugu(session)
      await roomNumber(config, session, tsuguUserData, number, session.content)
      return next();
    } else {
      return next();
    }
  })
  ctx.command('开启车牌转发', '开启车牌自动转发', cmdConfig)
    .action(async ({ session }) => {
      return await commandSwitchShareRoomNumberMode(config, session, true)
    })
  ctx.command('关闭车牌转发', '关闭车牌自动转发', cmdConfig)
    .action(async ({ session }) => {
      return await commandSwitchShareRoomNumberMode(config, session, false)
    })

  ctx.command('绑定玩家 [serverName:text]', '绑定玩家信息', cmdConfig)
    .usage('请勿在本指令后添加玩家ID。省略服务器名默认主服务器; 获得临时验证数字后, 将玩家签名改为该数字并回复玩家ID')
    .action(async ({ session }, serverName) => {
      const tsuguUserData = await observeUserTsugu(session)
      let mainServer: Server = tsuguUserData.mainServer
      if (serverName) {
        const serverFromServerNameFuzzySearch = await serverNameFuzzySearchResult(config, serverName)
        if (serverFromServerNameFuzzySearch == -1) {
          return '错误: 服务器名未能匹配任何服务器'
        }
        mainServer = serverFromServerNameFuzzySearch
      }
      return await commandBindPlayer(config, session, mainServer)
    })
  ctx.command('解除绑定 [serverName:text]', '解除玩家绑定', cmdConfig)
    .alias('解绑玩家')
    .usage('解除指定服务器的玩家绑定, 省略服务器名默认主服务器')
    .action(async ({ session }, serverName) => {
      const tsuguUserData = await observeUserTsugu(session)
      let mainServer: Server = tsuguUserData.mainServer
      if (serverName) {
        const serverFromServerNameFuzzySearch = await serverNameFuzzySearchResult(config, serverName)
        if (serverFromServerNameFuzzySearch == -1) {
          return '错误: 服务器名未能匹配任何服务器'
        }
        mainServer = serverFromServerNameFuzzySearch
      }
      return await commandUnbindPlayer(config, session, mainServer)
    })
  ctx.command('主服务器 <serverName:text>', '设置主服务器', cmdConfig)
    .alias('服务器模式', '切换服务器')
    .usage('将指定的服务器设置为你的主服务器')
    .example('主服务器 cn : 将国服设置为主服务器')
    .example('日服模式 : 将日服设置为主服务器')
    .shortcut(/^(.+服)模式$/, { args: ['$1'] })
    .action(async ({ session }, serverName) => {
      let mainServer: Server
      if (serverName) {
        const serverFromServerNameFuzzySearch = await serverNameFuzzySearchResult(config, serverName)
        if (serverFromServerNameFuzzySearch == -1) {
          return '错误: 服务器名未能匹配任何服务器'
        }
        mainServer = serverFromServerNameFuzzySearch
      } else {
        //return usage help and example
        return `错误: 指令不完整\n使用以下指令以查看帮助:\n  help 主服务器`
      }
      return await commandSwitchServerMode(config, session, mainServer)
    })
  ctx.command('设置显示服务器 <...serverList>', '设置默认服务器排序', cmdConfig)
    .alias('默认服务器', '设置默认服务器')
    .usage('使用空格分隔服务器列表')
    .example('设置默认服务器 国服 日服 : 将国服设置为第一服务器, 日服设置为第二服务器')
    .action(async ({ session }, ...serverList) => {
      return await commandSwitchDisplayedServerList(config, session, serverList)
    })
  ctx.command('玩家状态 [index]', '查询自己的玩家状态', cmdConfig)
    .shortcut(/^(.+服)玩家状态$/, { args: ['$1'] })
    .action(async ({ session }, index) => {
      if (index != undefined && !/^-?\d+$/.test(String(index).trim())) {
        //快捷方式 (xx服)玩家状态: 将服务器名转换为该服务器绑定玩家的绑定信息ID
        const serverFromServerNameFuzzySearch = await serverNameFuzzySearchResult(config, String(index).trim())
        if (serverFromServerNameFuzzySearch == -1) {
          return '错误: 服务器名未能匹配任何服务器'
        }
        const tsuguUserData = await observeUserTsugu(session)
        const bindingIndex = tsuguUserData.userPlayerList.findIndex((player) => player.server == serverFromServerNameFuzzySearch)
        if (bindingIndex == -1) {
          return `错误: 未绑定${serverNameFullList[serverFromServerNameFuzzySearch]}玩家, 请发送[绑定玩家]开始绑定`
        }
        return await commandPlayerInfo(config, session, bindingIndex + 1)
      }
      return await commandPlayerInfo(config, session, index == undefined ? undefined : Number(String(index).trim()))
    })
  ctx.command('玩家状态列表', '查询已绑定的玩家列表', cmdConfig)
    .alias('玩家列表', '玩家信息列表')
    .action(async ({ session }) => {
      return await commandPlayerList(config, session)
    })
  ctx.command('玩家默认ID <index:integer>', '设置默认玩家ID', cmdConfig)
    .usage('调整玩家状态指令，和发送车牌时的默认玩家信息。\n规则: \n如果该ID对应的玩家信息在当前默认服务器中, 显示。\n如果不在当前默认服务器中, 显示当前默认服务器的编号最靠前的玩家信息')
    .alias('默认玩家ID', '默认玩家', '玩家ID')
    .action(async ({ session }, index) => {
      if (index == undefined) {
        return `错误: 指令不完整\n使用以下指令以查看帮助:\n  help 玩家默认ID`
      }
      return await commandSwitchPlayerIndex(config, session, index)
    })

  //其他
  ctx.command('ycm [keyword:text]', '获取车牌', cmdConfig)
    .alias('有车吗', '车来')
    .usage(`获取所有车牌, 可以通过关键词过滤, 关键词支持正则表达式, 无效正则将按普通文本匹配`)
    .example('ycm : 获取所有车牌')
    .example('ycm 大分: 获取所有车牌, 其中包含"大分"关键词的车牌')
    .example('ycm e|s : 获取所有车牌, 其中包含"e"或"s"的车牌')
    .action(async ({ session }, keyword) => {
      const list = await commandRoomList(config, keyword)
      return (paresMessageList(list))
    })
  ctx.command('查房间 <roomNumber:string>', '查询房间内玩家列表', cmdConfig)
    .alias('查询房间')
    .usage('传入房间号, 以文字返回房间内玩家的名称和UID。仅支持国服房间, 房间号为6位数字。上游限制两次查询至少间隔10秒')
    .example('查房间 829326 :返回房间829326内所有玩家的名称和UID')
    .action(async ({ session }, roomNumber) => {
      if (roomNumber == undefined) {
        return `错误: 指令不完整\n使用以下指令以查看帮助:\n  help 查房间`
      }
      const list = await commandCheckRoom(config, roomNumber.trim())
      return (paresMessageList(list))
    })
  ctx.command('查玩家 <playerId:integer> [serverName:text]', '查询玩家信息', cmdConfig)
    .alias('查询玩家')
    .usage('查询指定ID玩家的信息。省略服务器名时, 默认从你当前的主服务器查询')
    .example('查玩家 10000000 : 查询你当前默认服务器中, 玩家ID为10000000的玩家信息')
    .example('查玩家 40474621 jp : 查询日服玩家ID为40474621的玩家信息')
    .action(async ({ session }, playerId, serverName) => {
      if (playerId == undefined) {
        return `错误: 指令不完整\n使用以下指令以查看帮助:\n  help 查玩家`
      }
      if (!Number.isInteger(playerId) || playerId < 1) {
        return '错误: 玩家ID必须为正整数'
      }
      const tsuguUserData = await observeUserTsugu(session)
      let mainServer: Server = tsuguUserData.mainServer
      if (serverName) {
        const serverFromServerNameFuzzySearch = await serverNameFuzzySearchResult(config, serverName)
        if (serverFromServerNameFuzzySearch == -1) {
          return '错误: 服务器名未能匹配任何服务器'
        }
        mainServer = serverFromServerNameFuzzySearch
      }
      const list = await commandSearchPlayer(config, playerId, mainServer)
      return (paresMessageList(list))
    })
  ctx.command('查PT', '查询国服当前活动PT', cmdConfig)
    .alias('查pt')
    .usage('查询绑定国服玩家的当前活动PT数据 (当前排名/PT/邻近排名/月榜)。\n需先用 设置令牌 配置本人令牌')
    .example('查PT : 查询自己绑定的国服玩家的当前活动PT数据')
    .action(async ({ session }) => {
      const tsuguUserData = await observeUserTsugu(session)
      //仅支持国服: 查找自己绑定的国服玩家
      const cnPlayer = tsuguUserData.userPlayerList.find((player) => player.server == Server.cn)
      if (cnPlayer == undefined) {
        return '错误: 未绑定国服玩家, 请发送[绑定玩家]开始绑定'
      }
      const list = await commandPlayerPt(config, cnPlayer.playerId, session.platform, session.userId)
      return (paresMessageList(list))
    })
  ctx.command('查歌榜', '查询国服当前活动歌曲排名', cmdConfig)
    .alias('查曲榜')
    .usage('查询绑定国服玩家的当前活动每曲排名数据 (每曲排名/分数/邻近排名)。\n需先用 设置令牌 配置本人令牌')
    .example('查歌榜 : 查询自己绑定的国服玩家的当前活动歌曲排名数据')
    .action(async ({ session }) => {
      const tsuguUserData = await observeUserTsugu(session)
      //仅支持国服: 查找自己绑定的国服玩家
      const cnPlayer = tsuguUserData.userPlayerList.find((player) => player.server == Server.cn)
      if (cnPlayer == undefined) {
        return '错误: 未绑定国服玩家, 请发送[绑定玩家]开始绑定'
      }
      const list = await commandPlayerMusic(config, cnPlayer.playerId, session.platform, session.userId)
      return (paresMessageList(list))
    })
  ctx.command('设置令牌 [token:text]', '设置查PT/查歌榜所需令牌', cmdConfig)
    .usage('通过哔哩哔哩APP扫码登录, 设置本人凭据, 供 导入全部配置/查PT/查歌榜 使用。\n需提前绑定国服玩家。\n为保护账号凭据安全, 该指令仅可在私聊中使用')
    .example('设置令牌 : 发送登录二维码, 扫码完成设置')
    .example('设置令牌 删除 : 清除已保存的令牌')
    .action(async ({ session }, token) => {
      //涉及账号凭据, 仅允许私聊使用, 群聊中只回复提示
      if (!session.isDirect) {
        return '为保护账号凭据安全, 设置令牌 仅支持私聊使用, 请私信我后再试'
      }
      //令牌为国服游戏账号凭据, 需提前绑定国服玩家
      const tsuguUserData = await observeUserTsugu(session)
      const cnPlayer = tsuguUserData.userPlayerList.find((player) => player.server == Server.cn)
      if (cnPlayer == undefined) {
        return '错误: 未绑定国服玩家, 请发送[绑定玩家]开始绑定'
      }
      const tokenText = token == undefined ? '' : String(token).trim()
      if (tokenText == '删除') {
        const list = await commandSetTokenDelete(config, session)
        return (paresMessageList(list))
      }
      if (tokenText != '') {
        return '设置令牌 已改为扫码登录, 请直接发送 设置令牌 并按提示扫码'
      }
      const list = await commandSetToken(config, session)
      return (paresMessageList(list))
    })
  ctx.command('查岗 <playerId:string> [limit:string] [eventId] [serverName:string]', '查询玩家历史分数变化', cmdConfig)
    .option('count', '-c <count:number> 指定显示最近的几次分数变化，默认20次')
    .option('day', '-d <day:number> 指定活动开始的第几天的分数变动详情')
    .action(async ({ session, options }, playerId, limit, eventId, serverName) => {
      if (playerId == undefined) {
        return `错误: 指令不完整\n使用以下指令以查看帮助:\n  help 查岗`
      }
      var tier
      if (/^[tT]\d+$/.test(playerId)) {
        //t1-t10格式: 指定排名
        tier = parseInt(playerId.slice(1))
        if (tier > 10 || tier < 1) {
          return `请确认输入的排名在1到10之间`
        }
        playerId = undefined
      }
      else if (!/^\d+$/.test(playerId)) {
        return `请确认输入玩家id或者排名格式正确`
      }
      let scoreLimit: string
      if (limit) {
        const normalized = limit.trim().replace(/＞/g, '>').replace(/＜/g, '<').replace(/＝/g, '=')
        if (/^(?:[<>]=?\d+|\d+-\d+)$/.test(normalized)) {
          scoreLimit = normalized
        } else {
          serverName = eventId
          eventId = limit
        }
      }
      if (eventId !== undefined && isNaN(Number(eventId))) {
        serverName = eventId
        eventId = undefined
      }
      if (options.day != null && (options.day < 0 || !Number.isInteger(options.day))) {
        return '参数 day 输入无效，请提供一个非负整数'
      }
      if (options.count != undefined && (!Number.isInteger(options.count) || options.count < 1)) {
        return '参数 count 输入无效，请提供一个正整数'
      }
      const tsuguUserData = await observeUserTsugu(session)
      let mainServer: Server = tsuguUserData.mainServer
      if (serverName) {
        const serverFromServerNameFuzzySearch = await serverNameFuzzySearchResult(config, serverName)
        if (serverFromServerNameFuzzySearch == -1) {
          return '错误: 服务器名未能匹配任何服务器'
        }
        mainServer = serverFromServerNameFuzzySearch
      }
      const list = await commandTopRateDetail(
        config,
        eventId === undefined ? undefined : Number(eventId),
        options.day,
        scoreLimit,
        options.count,
        playerId,
        tier,
        mainServer,
      )
      return (paresMessageList(list))
    })

  ctx.command('分数图 <playerId:string> [limit:string] [eventId] [serverName:string]', '查询分数散点图', cmdConfig)
    .action(async ({ session }, playerId, limit, eventId, serverName) => {
      if (playerId == undefined) return '错误: 指令不完整\n使用以下指令以查看帮助:\n  help 分数图'
      let tier: number
      if (isNaN(parseInt(playerId))) {
        if (/^t\d+$/i.test(playerId)) {
          tier = parseInt(playerId.slice(1))
          playerId = undefined
        } else {
          return '请确认输入玩家 ID 或排名格式正确'
        }
        if (tier > 10 || tier < 1) return '请确认输入的排名在 1 到 10 之间'
      }
      if (playerId != undefined && !/^\d+$/.test(playerId)) {
        return '请确认输入玩家 ID 格式正确'
      }
      let scoreLimit: string
      if (limit) {
        const normalized = limit.trim().replace(/＞/g, '>').replace(/＜/g, '<').replace(/＝/g, '=')
        if (/^(?:[<>]=?\d+|\d+-\d+)$/.test(normalized)) {
          scoreLimit = normalized
        } else {
          serverName = eventId
          eventId = limit
        }
      }
      if (eventId !== undefined && isNaN(Number(eventId))) {
        serverName = eventId
        eventId = undefined
      }
      const tsuguUserData = await observeUserTsugu(session)
      let mainServer: Server = tsuguUserData.mainServer
      if (serverName) {
        const matchedServer = await serverNameFuzzySearchResult(config, serverName)
        if (matchedServer == -1) return '错误: 服务器名未能匹配任何服务器'
        mainServer = matchedServer
      }
      const list = await commandTopPointStat(
        config,
        eventId === undefined ? undefined : Number(eventId),
        scoreLimit,
        playerId,
        tier,
        mainServer,
      )
      return paresMessageList(list)
    })

  ctx.command('前十车速 [commandArgs:text]', '查询当前前十车速排名', cmdConfig)
    .option('length', '-l <length:string> 指定时间范围，默认60分钟')
    .option('time', '-t <time:string> 指定结束时间，格式为 H 或 HH:mm')
    .option('date', '-d <date:string> 指定结束日期，格式为年/月/日或月/日')
    .option('player', '-p <player:string> 指定玩家或排名')
    .action(async ({ session, options }, commandArgs) => {
      const isPlayer = (value: string) => /^t([1-9]|10)$/i.test(value) || /^p\d+$/i.test(value)
      const isHour = (value: string) => /^(?:[01]?\d|2[0-4])(?:[:：][0-5]\d)?$/.test(value)
      const isDate = (value: string) => /^(?:(\d{4})[/.](\d{1,2})[/.](\d{1,2})|(\d{1,2})[/.](\d{1,2}))$/.test(value)
      const isTimeRange = (value: string) => /^\d+(?:min|h|m)?$/i.test(value)
      let player = options.player
      let length = options.length && isTimeRange(options.length) ? parseTimeToMinutes(options.length) : undefined
      let timeText = options.time && isHour(options.time) ? options.time : undefined
      let date = options.date && isDate(options.date) ? parseDate(options.date) : undefined
      let serverName: string
      for (const arg of commandArgs?.trim().split(/\s+/) ?? []) {
        if (isPlayer(arg)) player ??= arg.replace(/^p/i, '')
        else if (isHour(arg)) timeText ??= arg
        else if (isDate(arg)) date ??= parseDate(arg)
        else if (isTimeRange(arg)) length ??= parseTimeToMinutes(arg)
        else if (!/\d/.test(arg)) serverName ??= arg
      }
      if (timeText) {
        const [hour, minute = 0] = timeText.split(/[:：]/).map(Number)
        const base = date ?? new Date()
        date = new Date(base.getFullYear(), base.getMonth(), base.getDate(), hour, minute, 0, 0)
      }
      const tsuguUserData = await observeUserTsugu(session)
      let mainServer: Server = tsuguUserData.mainServer
      if (serverName) {
        const matchedServer = await serverNameFuzzySearchResult(config, serverName)
        if (matchedServer == -1) return '错误: 服务器名未能匹配任何服务器'
        mainServer = matchedServer
      }
      let compareTier: number
      let comparePlayerUid: number
      if (player?.startsWith('t')) compareTier = Number(player.slice(1))
      else if (player && !/^\d+$/.test(player)) return '参数 player 输入无效，请指定正确排名或 UID'
      else if (player) comparePlayerUid = Number(player)
      length ??= 60
      const list = await commandTopRateRanking(config, mainServer, length, date, compareTier, comparePlayerUid)
      return paresMessageList(list)
    })

  ctx.command('分速表 [commandArgs:text]', '查询当前前十分速表', cmdConfig)
    .option('length', '-l <length:string> 指定时间范围，默认60分钟')
    .option('allPlayer', '-a 显示全部玩家')
    .option('time', '-t <time:string> 指定结束时间，格式为 H 或 HH:mm')
    .option('date', '-d <date:string> 指定结束日期，格式为年/月/日或月/日')
    .action(async ({ session, options }, commandArgs) => {
      const isHour = (value: string) => /^(?:[01]?\d|2[0-4])(?:[:：][0-5]\d)?$/.test(value)
      const isDate = (value: string) => /^(?:(\d{4})[/.](\d{1,2})[/.](\d{1,2})|(\d{1,2})[/.](\d{1,2}))$/.test(value)
      const isTimeRange = (value: string) => /^\d+(?:min|h|m)?$/i.test(value)
      let length = options.length && isTimeRange(options.length) ? parseTimeToMinutes(options.length) : undefined
      let timeText = options.time && isHour(options.time) ? options.time : undefined
      let date = options.date && isDate(options.date) ? parseDate(options.date) : undefined
      let serverName: string
      for (const arg of commandArgs?.trim().split(/\s+/) ?? []) {
        if (isHour(arg)) timeText ??= arg
        else if (isDate(arg)) date ??= parseDate(arg)
        else if (isTimeRange(arg)) length ??= parseTimeToMinutes(arg)
        else if (arg === '-a') options.allPlayer = true
        else if (!/\d/.test(arg)) serverName ??= arg
      }
      if (timeText) {
        const [hour, minute = 0] = timeText.split(/[:：]/).map(Number)
        const base = date ?? new Date()
        date = new Date(base.getFullYear(), base.getMonth(), base.getDate(), hour, minute, 0, 0)
      }
      const tsuguUserData = await observeUserTsugu(session)
      let mainServer: Server = tsuguUserData.mainServer
      if (serverName) {
        const matchedServer = await serverNameFuzzySearchResult(config, serverName)
        if (matchedServer == -1) return '错误: 服务器名未能匹配任何服务器'
        mainServer = matchedServer
      }
      length ??= 60
      const list = await commandTopTenMinuteSpeed(config, mainServer, length, date, options.allPlayer)
      return paresMessageList(list)
    })

  ctx.command('月榜查岗 <playerId:string> [limit:string] [monthlyRankingId] [serverName:string]', '查询玩家月榜历史分数变化', cmdConfig)
    .option('count', '-c <count:number> 指定显示最近的几次分数变化，默认20次')
    .option('day', '-d <day:number> 指定月榜开始的第几天的分数变动详情')
    .action(async ({ session, options }, playerId, limit, monthlyRankingId, serverName) => {
      if (playerId == undefined) {
        return `错误: 指令不完整\n使用以下指令以查看帮助:\n  help 月榜查岗`
      }
      var tier
      if (/^[tT]\d+$/.test(playerId)) {
        //t1-t10格式: 指定排名
        tier = parseInt(playerId.slice(1))
        if (tier > 10 || tier < 1) {
          return `请确认输入的排名在1到10之间`
        }
        playerId = undefined
      }
      else if (!/^\d+$/.test(playerId)) {
        return `请确认输入玩家id或者排名格式正确`
      }
      let scoreLimit: string
      if (limit) {
        const normalized = limit.trim().replace(/＞/g, '>').replace(/＜/g, '<').replace(/＝/g, '=')
        if (/^(?:[<>]=?\d+|\d+-\d+)$/.test(normalized)) {
          scoreLimit = normalized
        } else {
          serverName = monthlyRankingId
          monthlyRankingId = limit
        }
      }
      if (monthlyRankingId !== undefined && isNaN(Number(monthlyRankingId))) {
        serverName = monthlyRankingId
        monthlyRankingId = undefined
      }
      if (options.day != null && (options.day < 0 || !Number.isInteger(options.day))) {
        return '参数 day 输入无效，请提供一个非负整数'
      }
      if (options.count != undefined && (!Number.isInteger(options.count) || options.count < 1)) {
        return '参数 count 输入无效，请提供一个正整数'
      }
      const tsuguUserData = await observeUserTsugu(session)
      let mainServer: Server = tsuguUserData.mainServer
      if (serverName) {
        const serverFromServerNameFuzzySearch = await serverNameFuzzySearchResult(config, serverName)
        if (serverFromServerNameFuzzySearch == -1) {
          return '错误: 服务器名未能匹配任何服务器'
        }
        mainServer = serverFromServerNameFuzzySearch
      }
      const list = await commandMonthlyTopRateDetail(
        config,
        monthlyRankingId === undefined ? undefined : Number(monthlyRankingId),
        options.day,
        scoreLimit,
        options.count,
        playerId,
        tier,
        mainServer,
      )
      return (paresMessageList(list))
    })

  ctx.command('月榜分数图 <playerId:string> [limit:string] [monthlyRankingId] [serverName:string]', '查询月榜分数散点图', cmdConfig)
    .action(async ({ session }, playerId, limit, monthlyRankingId, serverName) => {
      if (playerId == undefined) return '错误: 指令不完整\n使用以下指令以查看帮助:\n  help 月榜分数图'
      let tier: number
      if (isNaN(parseInt(playerId))) {
        if (/^t\d+$/i.test(playerId)) {
          tier = parseInt(playerId.slice(1))
          playerId = undefined
        } else {
          return '请确认输入玩家 ID 或排名格式正确'
        }
        if (tier > 10 || tier < 1) return '请确认输入的排名在 1 到 10 之间'
      }
      if (playerId != undefined && !/^\d+$/.test(playerId)) {
        return '请确认输入玩家 ID 格式正确'
      }
      let scoreLimit: string
      if (limit) {
        const normalized = limit.trim().replace(/＞/g, '>').replace(/＜/g, '<').replace(/＝/g, '=')
        if (/^(?:[<>]=?\d+|\d+-\d+)$/.test(normalized)) {
          scoreLimit = normalized
        } else {
          serverName = monthlyRankingId
          monthlyRankingId = limit
        }
      }
      if (monthlyRankingId !== undefined && isNaN(Number(monthlyRankingId))) {
        serverName = monthlyRankingId
        monthlyRankingId = undefined
      }
      const tsuguUserData = await observeUserTsugu(session)
      let mainServer: Server = tsuguUserData.mainServer
      if (serverName) {
        const matchedServer = await serverNameFuzzySearchResult(config, serverName)
        if (matchedServer == -1) return '错误: 服务器名未能匹配任何服务器'
        mainServer = matchedServer
      }
      const list = await commandMonthlyTopPointStat(
        config,
        monthlyRankingId === undefined ? undefined : Number(monthlyRankingId),
        scoreLimit,
        playerId,
        tier,
        mainServer,
      )
      return paresMessageList(list)
    })

  ctx.command('月榜前十车速 [commandArgs:text]', '查询当前月榜前十车速排名', cmdConfig)
    .option('length', '-l <length:string> 指定时间范围，默认60分钟')
    .option('time', '-t <time:string> 指定结束时间，格式为 H 或 HH:mm')
    .option('date', '-d <date:string> 指定结束日期，格式为年/月/日或月/日')
    .option('player', '-p <player:string> 指定玩家或排名')
    .action(async ({ session, options }, commandArgs) => {
      const isPlayer = (value: string) => /^t([1-9]|10)$/i.test(value) || /^p\d+$/i.test(value)
      const isHour = (value: string) => /^(?:[01]?\d|2[0-4])(?:[:：][0-5]\d)?$/.test(value)
      const isDate = (value: string) => /^(?:(\d{4})[/.](\d{1,2})[/.](\d{1,2})|(\d{1,2})[/.](\d{1,2}))$/.test(value)
      const isTimeRange = (value: string) => /^\d+(?:min|h|m)?$/i.test(value)
      let player = options.player
      let length = options.length && isTimeRange(options.length) ? parseTimeToMinutes(options.length) : undefined
      let timeText = options.time && isHour(options.time) ? options.time : undefined
      let date = options.date && isDate(options.date) ? parseDate(options.date) : undefined
      let serverName: string
      for (const arg of commandArgs?.trim().split(/\s+/) ?? []) {
        if (isPlayer(arg)) player ??= arg.replace(/^p/i, '')
        else if (isHour(arg)) timeText ??= arg
        else if (isDate(arg)) date ??= parseDate(arg)
        else if (isTimeRange(arg)) length ??= parseTimeToMinutes(arg)
        else if (!/\d/.test(arg)) serverName ??= arg
      }
      if (timeText) {
        const [hour, minute = 0] = timeText.split(/[:：]/).map(Number)
        const base = date ?? new Date()
        date = new Date(base.getFullYear(), base.getMonth(), base.getDate(), hour, minute, 0, 0)
      }
      const tsuguUserData = await observeUserTsugu(session)
      let mainServer: Server = tsuguUserData.mainServer
      if (serverName) {
        const matchedServer = await serverNameFuzzySearchResult(config, serverName)
        if (matchedServer == -1) return '错误: 服务器名未能匹配任何服务器'
        mainServer = matchedServer
      }
      let compareTier: number
      let comparePlayerUid: number
      if (player?.startsWith('t')) compareTier = Number(player.slice(1))
      else if (player && !/^\d+$/.test(player)) return '参数 player 输入无效，请指定正确排名或 UID'
      else if (player) comparePlayerUid = Number(player)
      length ??= 60
      const list = await commandMonthlyTopRateRanking(config, mainServer, length, date, compareTier, comparePlayerUid)
      return paresMessageList(list)
    })

  ctx.command('月榜分速表 [commandArgs:text]', '查询当前月榜前十分速表', cmdConfig)
    .option('length', '-l <length:string> 指定时间范围，默认60分钟')
    .option('allPlayer', '-a 显示全部玩家')
    .option('time', '-t <time:string> 指定结束时间，格式为 H 或 HH:mm')
    .option('date', '-d <date:string> 指定结束日期，格式为年/月/日或月/日')
    .action(async ({ session, options }, commandArgs) => {
      const isHour = (value: string) => /^(?:[01]?\d|2[0-4])(?:[:：][0-5]\d)?$/.test(value)
      const isDate = (value: string) => /^(?:(\d{4})[/.](\d{1,2})[/.](\d{1,2})|(\d{1,2})[/.](\d{1,2}))$/.test(value)
      const isTimeRange = (value: string) => /^\d+(?:min|h|m)?$/i.test(value)
      let length = options.length && isTimeRange(options.length) ? parseTimeToMinutes(options.length) : undefined
      let timeText = options.time && isHour(options.time) ? options.time : undefined
      let date = options.date && isDate(options.date) ? parseDate(options.date) : undefined
      let serverName: string
      for (const arg of commandArgs?.trim().split(/\s+/) ?? []) {
        if (isHour(arg)) timeText ??= arg
        else if (isDate(arg)) date ??= parseDate(arg)
        else if (isTimeRange(arg)) length ??= parseTimeToMinutes(arg)
        else if (arg === '-a') options.allPlayer = true
        else if (!/\d/.test(arg)) serverName ??= arg
      }
      if (timeText) {
        const [hour, minute = 0] = timeText.split(/[:：]/).map(Number)
        const base = date ?? new Date()
        date = new Date(base.getFullYear(), base.getMonth(), base.getDate(), hour, minute, 0, 0)
      }
      const tsuguUserData = await observeUserTsugu(session)
      let mainServer: Server = tsuguUserData.mainServer
      if (serverName) {
        const matchedServer = await serverNameFuzzySearchResult(config, serverName)
        if (matchedServer == -1) return '错误: 服务器名未能匹配任何服务器'
        mainServer = matchedServer
      }
      length ??= 60
      const list = await commandMonthlyTopTenMinuteSpeed(config, mainServer, length, date, options.allPlayer)
      return paresMessageList(list)
    })
  ctx.command("查卡 <word:text>", "查询卡牌信息", cmdConfig)
    .alias('查卡牌')
    .usage('根据关键词或卡牌ID查询卡片信息, 请使用空格隔开所有参数')
    .example('查卡 1399 :返回1399号卡牌的信息').example('查卡 绿 tsugu :返回所有属性为pure的羽泽鸫的卡牌列表')
    .action(async ({ session }, text) => {
      if (text == undefined) {
        return `错误: 指令不完整\n使用以下指令以查看帮助:\n  help 查卡`
      }
      const tsuguUserData = await observeUserTsugu(session)
      const displayedServerList = tsuguUserData.displayedServerList
      //若已绑定玩家，附带当前绑定的玩家信息，用于在卡牌列表中标记已拥有的卡牌
      let playerInfo: { playerId: number, server: Server } | undefined
      if (tsuguUserData.userPlayerList.length != 0) {
        const player = tsuguUserData.userPlayerList[tsuguUserData.userPlayerIndex]
        if (player != undefined) {
          playerInfo = { playerId: player.playerId, server: player.server }
        }
      }
      const list = await commandCard(config, displayedServerList, text, playerInfo)
      return (paresMessageList(list))
    })
  ctx.command('查卡面 <cardId:integer>', '查询卡牌插画', cmdConfig)
    .alias('查卡插画', '查插画')
    .option('trim', '-t <trim:boolean>')
    .usage('根据卡片ID查询卡片插画').example('查卡面 1399 :返回1399号卡牌的插画')
    .action(async ({ session, options }, cardId) => {
      if (cardId == undefined) {
        return `错误: 指令不完整\n使用以下指令以查看帮助:\n  help 查卡面`
      }
      if (!Number.isInteger(cardId) || cardId < 1) {
        return '错误: 卡牌ID必须为正整数'
      }
      const list = await commandGetCardIllustration(config, cardId, options.trim)
      return paresMessageList(list)
    })
  ctx.command('查角色 <word:text>', '查询角色信息', cmdConfig)
    .usage('根据关键词或角色ID查询角色信息')
    .example('查角色 10 :返回10号角色的信息').example('查角色 吉他 :返回所有角色模糊搜索标签中包含吉他的角色列表')
    .action(async ({ session }, text) => {
      if (text == undefined) {
        return `错误: 指令不完整\n使用以下指令以查看帮助:\n  help 查角色`
      }
      const tsuguUserData = await observeUserTsugu(session)
      const displayedServerList = tsuguUserData.displayedServerList
      const list = await commandCharacter(config, displayedServerList, text)
      return paresMessageList(list)
    })

  ctx.command("查活动 <word:text>", "查询活动信息", cmdConfig)
    .usage('根据关键词或活动ID查询活动信息')
    .example('查活动 177 :返回177号活动的信息').example('查活动 绿 tsugu :返回所有属性加成为pure, 且活动加成角色中包括羽泽鸫的活动列表')
    .action(async ({ session }, text) => {
      if (text == undefined) {
        return `错误: 指令不完整\n使用以下指令以查看帮助:\n  help 查活动`
      }
      const tsuguUserData = await observeUserTsugu(session)
      const displayedServerList = tsuguUserData.displayedServerList
      const list = await commandEvent(config, displayedServerList, text)
      return paresMessageList(list)
    })
  ctx.command('查月榜 <word:text>', '查询月榜信息', cmdConfig)
    .usage('根据关键词或月榜 ID 查询月榜信息')
    .example('查月榜 17 :返回 17 号月榜的信息')
    .action(async ({ session }, text) => {
      if (text == undefined) return '错误: 指令不完整\n使用以下指令以查看帮助:\n  help 查月榜'
      const tsuguUserData = await observeUserTsugu(session)
      const list = await commandMonthlyRanking(config, tsuguUserData.displayedServerList, text)
      return paresMessageList(list)
    })

  ctx.command('查广告位 [eventId:integer]', '查询国服活动PT榜广告位玩家', cmdConfig)
    .alias('查PT广告位')
    .usage('查询国服活动 PT 榜各档位广告位玩家, 展示档位、玩家、PT 等信息。省略活动 ID 时, 默认查询当前活动(会随时间变化)')
    .example('查广告位 :返回当前活动 PT 榜各档位广告位玩家')
    .example('查广告位 322 :返回 322 号活动 PT 榜各档位广告位玩家')
    .action(async ({ session }, eventId) => {
      if (eventId != undefined && (!Number.isInteger(eventId) || eventId < 1)) {
        return '错误: 活动ID必须为正整数'
      }
      const list = await commandEventBorderPlayers(config, eventId)
      return (paresMessageList(list))
    })
  ctx.command('查歌榜广告位 [eventId:integer]', '查询国服活动歌榜广告位玩家', cmdConfig)
    .usage('查询国服活动歌榜各档位广告位玩家。仅 CP/组曲/对邦 类型的活动有歌榜, 任务协力/EX协力 活动没有歌榜。省略活动 ID 时, 默认查询当前活动(会随时间变化)')
    .example('查歌榜广告位 :返回当前活动歌榜各档位广告位玩家')
    .example('查歌榜广告位 322 :返回 322 号活动歌榜各档位广告位玩家')
    .action(async ({ session }, eventId) => {
      if (eventId != undefined && (!Number.isInteger(eventId) || eventId < 1)) {
        return '错误: 活动ID必须为正整数'
      }
      const list = await commandMusicBorderPlayers(config, eventId)
      return (paresMessageList(list))
    })
  ctx.command('查月榜广告位 [monthlyId:integer]', '查询国服月榜广告位玩家', cmdConfig)
    .usage('查询国服月榜各档位广告位玩家。省略月榜 ID 时, 默认查询当前月榜(会随时间变化)')
    .example('查月榜广告位 :返回当前月榜各档位广告位玩家')
    .example('查月榜广告位 20 :返回第 20 期月榜各档位广告位玩家')
    .action(async ({ session }, monthlyId) => {
      if (monthlyId != undefined && (!Number.isInteger(monthlyId) || monthlyId < 1)) {
        return '错误: 月榜ID必须为正整数'
      }
      const list = await commandMonthlyBorderPlayers(config, monthlyId)
      return (paresMessageList(list))
    })

  ctx.command('结榜图 <playerId:integer> <ranking:integer> <pt:integer> [signature:text]', '记录国服活动PT榜结榜成绩', cmdConfig)
    .usage('在活动结束后3天内, 将玩家(按玩家ID查询)本期活动的PT榜结榜成绩记录到当前群, 供 查结榜图 展示\n排名与PT需手动填写, 玩家昵称/等级/签名/头像取记录时刻的玩家资料\n自定义签名会覆盖玩家当前签名显示')
    .example('结榜图 10000000 1 1000000 : 记录玩家10000000 第1名 1000000PT')
    .example('结榜图 10000000 100 500000 毕业快乐 : 记录成绩并以"毕业快乐"作为自定义签名')
    .action(async ({ session }, playerId, ranking, pt, signature) => {
      if (playerId == undefined || ranking == undefined || pt == undefined) {
        return `错误: 指令不完整\n使用以下指令以查看帮助:\n  help 结榜图`
      }
      if (!Number.isInteger(playerId) || playerId < 1) {
        return '错误: 玩家ID必须为正整数'
      }
      if (!Number.isInteger(ranking) || ranking < 1) {
        return '错误: 排名必须为正整数'
      }
      if (!Number.isInteger(pt) || pt < 0) {
        return '错误: PT必须为非负整数'
      }
      if (session.guildId == undefined) {
        return '错误: 本指令仅支持在群聊中使用'
      }
      const groupName = await getGroupName(session)
      const list = await commandFinalRankingSubmit(config, session.platform, session.guildId, groupName, 'event', playerId, ranking, pt, undefined, signature == undefined ? undefined : signature.trim(), `${session.platform}:${session.userId}`)
      return (paresMessageList(list))
    })

  ctx.command('歌榜结榜图 <playerId:integer> <ranking:integer> <score:integer> [rest:text]', '记录国服活动歌榜结榜成绩', cmdConfig)
    .usage('在活动结束后3天内, 将玩家本期活动的歌榜结榜成绩记录到当前群, 供 查结榜图 展示\n只有挑战(CP)活动有"第几首歌"参数(缺省第1首), 组曲/对邦活动无需填写\n第4个参数为纯数字1-3时优先判定为歌曲序号, 其余情况视为自定义签名')
    .example('歌榜结榜图 10000000 1 4200000 : 记录玩家10000000 歌榜第1名 4200000分')
    .example('歌榜结榜图 10000000 5 3800000 2 : 记录第2首歌的第5名')
    .example('歌榜结榜图 10000000 10 3500000 冲了 : 记录成绩并以"冲了"作为自定义签名')
    .action(async ({ session }, playerId, ranking, score, rest) => {
      if (playerId == undefined || ranking == undefined || score == undefined) {
        return `错误: 指令不完整\n使用以下指令以查看帮助:\n  help 歌榜结榜图`
      }
      if (!Number.isInteger(playerId) || playerId < 1) {
        return '错误: 玩家ID必须为正整数'
      }
      if (!Number.isInteger(ranking) || ranking < 1) {
        return '错误: 排名必须为正整数'
      }
      if (!Number.isInteger(score) || score < 0) {
        return '错误: 分数必须为非负整数'
      }
      if (session.guildId == undefined) {
        return '错误: 本指令仅支持在群聊中使用'
      }
      //第4参数二义性解析: 纯数字1-3优先视为歌曲序号, 其余(或剩余部分)为自定义签名
      let songIndex: number | undefined
      let signature: string | undefined
      if (rest != undefined && rest.trim() != '') {
        const tokens = rest.trim().split(/\s+/)
        if (/^[1-3]$/.test(tokens[0])) {
          songIndex = Number(tokens[0])
          signature = tokens.slice(1).join(' ')
        }
        else {
          signature = tokens.join(' ')
        }
        if (signature == '') {
          signature = undefined
        }
      }
      const groupName = await getGroupName(session)
      const list = await commandFinalRankingSubmit(config, session.platform, session.guildId, groupName, 'music', playerId, ranking, score, songIndex, signature, `${session.platform}:${session.userId}`)
      return (paresMessageList(list))
    })

  ctx.command('查结榜图 [action:string] [playerId:integer]', '查询本群活动结榜图', cmdConfig)
    .usage('生成本群的国服活动结榜图片, PT榜与歌榜均按排名排序, 歌榜在PT榜下方\n查结榜图 : 返回本群最新有记录的一期\n查结榜图 326 : 返回326号活动的结榜图\n查结榜图 删除 10000000 : 删除本群该玩家的结榜数据(仅群主/管理员)')
    .example('查结榜图 :返回本群最新一期的结榜图')
    .example('查结榜图 326 :返回326号活动本群的结榜图')
    .example('查结榜图 删除 10000000 :删除玩家10000000的结榜数据')
    .action(async ({ session }, action, playerId) => {
      if (session.guildId == undefined) {
        return '错误: 本指令仅支持在群聊中使用'
      }
      //删除分支: 仅群主/管理员
      if (action == '删除') {
        if (playerId == undefined || !Number.isInteger(playerId) || playerId < 1) {
          return '错误: 请提供要删除的玩家ID, 用法: 查结榜图 删除 玩家ID'
        }
        const adminCheck = await checkGroupAdmin(session)
        if (adminCheck == false) {
          return '错误: 删除指令仅限群主或管理员使用'
        }
        if (adminCheck == 'unknown') {
          return '错误: 无法确认你的群管理身份, 删除指令仅限群主/管理员'
        }
        const list = await commandFinalRankingDelete(config, session.platform, session.guildId, playerId)
        return (paresMessageList(list))
      }
      //查询分支: 无参数=最新一期, 纯数字=指定活动ID
      let eventId: number | undefined
      if (action != undefined) {
        const actionText = String(action).trim()
        if (!/^\d+$/.test(actionText)) {
          return `错误: 无法识别的参数 "${actionText}"\n使用以下指令以查看帮助:\n  help 查结榜图`
        }
        eventId = Number(actionText)
        if (eventId < 1) {
          return '错误: 活动ID必须为正整数'
        }
      }
      const groupName = await getGroupName(session)
      const list = await commandFinalRankingQuery(config, session.platform, session.guildId, groupName, eventId)
      return (paresMessageList(list))
    })

  ctx.command("查曲 <word:text>", "查询曲目信息", cmdConfig)
    .usage('根据关键词或曲目ID查询曲目信息')
    .example('查曲 1 :返回1号曲的信息').example('查曲 ag lv27 :返回所有难度为27的ag曲列表')
    .action(async ({ session }, text) => {
      if (text == undefined) {
        return `错误: 指令不完整\n使用以下指令以查看帮助:\n  help 查曲`
      }
      const tsuguUserData = await observeUserTsugu(session)
      const displayedServerList = tsuguUserData.displayedServerList
      const list = await commandSong(config, displayedServerList, text)
      return paresMessageList(list)
    })
  ctx.command("查谱面 <songId:integer> [difficultyText:text]", "查询谱面信息", cmdConfig)
    .usage('根据曲目ID与难度查询铺面信息')
    .example('查谱面 1 :返回1号曲的所有铺面').example('查谱面 1 expert :返回1号曲的expert难度铺面')
    .action(async ({ session }, songId, difficultyText) => {
      if (songId == undefined) {
        return `错误: 指令不完整\n使用以下指令以查看帮助:\n  help 查谱面`
      }
      if (!Number.isInteger(songId) || songId < 1) {
        return '错误: 曲目ID必须为正整数'
      }
      const tsuguUserData = await observeUserTsugu(session)
      const displayedServerList = tsuguUserData.displayedServerList
      let difficultyId: number
      if (difficultyText) {
        const fuzzySearchResult = await getFuzzySearchResult(config, difficultyText)
        if (!fuzzySearchResult['difficulty']) {
          return '错误: 难度名未能匹配任何难度'
        }
        difficultyId = fuzzySearchResult['difficulty'][0]
      }
      const list = await commandSongChart(config, displayedServerList, songId, difficultyId)
      return paresMessageList(list)
    })
  ctx.command("查自制谱 <songId:integer>", "查询自制谱信息", cmdConfig)
    .usage('根据ID查询自制谱信息')
    .example('查谱面 1 :返回1号曲的铺面')
    .action(async ({ session }, songId) => {
      if (songId == undefined) {
        return `错误: 指令不完整\n使用以下指令以查看帮助:\n  help 查自制谱`
      }
      if (!Number.isInteger(songId) || songId < 1) {
        return '错误: 曲目ID必须为正整数'
      }
      const list = await commandCommunitySongChart(config, songId)
      return paresMessageList(list)
    })
  ctx.command("随机曲 [word:text]", "随机返回曲目", cmdConfig)
    .usage('根据关键词或曲目ID查询曲目信息')
    .alias('随机')
    .example('随机曲 lv24 :在所有包含24等级难度的曲中, 随机返回其中一个').example('随机曲 lv24 ag :在所有包含24等级难度的afterglow曲中, 随机返回其中一个')
    .action(async ({ session }, text) => {
      const tsuguUserData = await observeUserTsugu(session)
      const mainServer = tsuguUserData.mainServer
      const list = await commandSongRandom(config, mainServer, text)
      return paresMessageList(list)
    })
  ctx.command('查询分数表 [serverName:string] [fever:string] [difficulty:string]', '查询歌曲分数表', cmdConfig)
    .usage('查询指定服务器的歌曲分数表, 如果没有服务器名的话, 服务器为国服\n参数 无fever / fever 表示不带 / 带Fever, 等价于选项 -f 0 / -f 1, 同时给出时以 -f 为准\n参数 <26 / >20 表示只展示难度低于 / 高于该值的曲目, 等价于选项 -d, 同时给出时以 -d 为准, 过滤只影响展示的曲目, 不改变排名\n默认技能倍率: 带Fever为150%, 无Fever为130%, 可用 -s 指定')
    .alias('查分数表', '查询分数榜', '查分数榜').example('查询分数表 cn :返回国服的歌曲分数表')
    .example('查询分数表 cn 无fever :返回国服的无Fever分数表')
    .example('查询分数表 -f 1 -s 150 -t 7 :返回带Fever, 技能倍率150%, 技能持续7秒的默认服务器分数表')
    .example('查询分数表 -f 0 :返回无Fever的默认服务器分数表')
    .example('查询分数表 cn <26 :返回国服的分数表, 只展示难度低于26的曲目')
    .example('查询分数表 -d >20 :返回默认服务器的分数表, 只展示难度高于20的曲目')
    .option('fever', '-f <fever:number> 是否带Fever, 1为带Fever(默认), 0为不带')
    .option('scoreup', '-s <scoreup:number> 技能倍率百分比, 带Fever默认150, 无Fever默认130')
    .option('time', '-t <time:number> 技能持续时间(秒), 默认7')
    .option('difficulty', '-d <difficulty:string> 难度过滤, 如 <26 只展示难度低于26的曲目, >20 只展示难度高于20的曲目, 不改变排名')
    .action(async ({ session, options }, serverName, feverText, difficultyText) => {
      //位置参数 [无]fever: 无fever 转换为 -f 0, fever 转换为 -f 1; <26 / >20 转换为 -d; 与服务器名参数顺序任意, 显式 -f / -d 选项优先
      let feverFromArg: boolean | undefined
      let serverNameArg: string | undefined
      let difficultyFromArg: string | undefined
      for (const arg of [serverName, feverText, difficultyText]) {
        if (arg == undefined) continue
        const text = String(arg).trim()
        if (/^(无)?fever$/i.test(text)) {
          feverFromArg = !text.startsWith('无')
        } else if (/^[<>]\d+(\.\d+)?$/.test(text)) {
          difficultyFromArg = text
        } else {
          serverNameArg = text
        }
      }
      let fever: boolean = true
      if (options.fever != undefined) {
        if (options.fever !== 0 && options.fever !== 1) {
          return '错误: 参数 -f 只能为 0 或 1'
        }
        fever = options.fever == 1
      }
      else if (feverFromArg != undefined) {
        fever = feverFromArg
      }
      //默认技能倍率: 带Fever为150, 无Fever为130, 显式 -s 优先
      let scoreUpMaxValue: number = fever ? 150 : 130
      if (options.scoreup != undefined) {
        if (!Number.isFinite(options.scoreup) || options.scoreup < 0 || options.scoreup > 1000) {
          return '错误: 参数 -s 只能为 0 到 1000 之间的数字'
        }
        scoreUpMaxValue = options.scoreup
      }
      let skillDuration: number = 7
      if (options.time != undefined) {
        if (!Number.isFinite(options.time) || options.time <= 0 || options.time > 20) {
          return '错误: 参数 -t 只能为 0 到 20 之间的正数'
        }
        skillDuration = options.time
      }
      //难度过滤: 显式 -d 选项优先, 否则使用位置参数; 只过滤展示的曲目, 不改变排名
      let difficultyFilter: string | undefined
      if (options.difficulty != undefined) {
        const text = String(options.difficulty).trim()
        if (!/^[<>]\d+(\.\d+)?$/.test(text)) {
          return '错误: 参数 -d 格式只能为 <数字 或 >数字, 如 <26 或 >20'
        }
        difficultyFilter = text
      }
      else if (difficultyFromArg != undefined) {
        difficultyFilter = difficultyFromArg
      }
      if (difficultyFilter != undefined) {
        const difficultyValue = parseFloat(difficultyFilter.slice(1))
        if (!(difficultyValue > 0 && difficultyValue <= 100)) {
          return '错误: 参数 -d 的难度值只能为 0 到 100 之间的正数'
        }
      }
      const tsuguUserData = await observeUserTsugu(session)
      const displayedServerList = tsuguUserData.displayedServerList
      let mainServer: Server = Server.cn
      if (serverNameArg) {
        const serverFromServerNameFuzzySearch = await serverNameFuzzySearchResult(config, serverNameArg)
        if (serverFromServerNameFuzzySearch == -1) {
          return '错误: 服务器名未能匹配任何服务器'
        }
        mainServer = serverFromServerNameFuzzySearch
      }
      const list = await commandSongMeta(config, displayedServerList, mainServer, fever, scoreUpMaxValue, skillDuration, difficultyFilter)
      return paresMessageList(list)

    })

  ctx.command("查试炼 [origin:string] [index:number]", "查询活动试炼信息", cmdConfig)
    .usage('查询当前服务器当前活动试炼信息\n可以自定义活动ID和日期')
    .alias('查stage', '查舞台', '查festival', '查5v5')
    .example('查试炼 2024.12.25 :返回2024.12.25对应活动的试炼信息, 包含歌曲meta')
    .example('查试炼 12.25 :返回当年12.25对应活动的试炼信息, 包含歌曲meta')
    .example('查试炼 261:返回261号活动第一天的试炼信息, 包含歌曲meta')
    .example('查试炼 261 7:返回261号活动第七天的试炼信息, 包含歌曲meta')
    .action(async ({ session, options }, origin, index) => {
      function parseDate(origin) {
        const list = origin?.match(/\d+/gim)
        if (!list || list.length == 0) 
          return {}
        if (list.length == 1 && parseInt(list[0]) > 31) {
          return { eventId: parseInt(list[0]) }
        }
        const now = new Date()
        return { date: new Date(list.at(-3) ?? now.getFullYear(), (list.at(-2) ?? now.getMonth() + 1) - 1, list.at(-1))}
      }
      const { eventId, date } = parseDate(origin)
      if (index != undefined && (!Number.isInteger(index) || index < 1)) {
        return '错误: 天数必须为正整数'
      }
      const tsuguUserData = await observeUserTsugu(session)
      const mainServer = tsuguUserData.mainServer
      const list = await commandEventStage(config, mainServer, eventId, index, date, true)
      return paresMessageList(list)
    })

  ctx.command("活动日历 [origin:text]", "查询国服活动日历", cmdConfig)
    .usage('查询国服活动日历图片, 包含活动档期(官方/预测)、节假日休班安排\n默认显示当月, 可以指定年月')
    .alias('查日历', '日历')
    .example('活动日历 :返回当月国服活动日历')
    .example('活动日历 10 :返回今年10月的国服活动日历')
    .example('活动日历 27-2 :返回2027年2月的国服活动日历')
    .example('活动日历 2026.10 :返回2026年10月的国服活动日历')
    .action(async ({ session }, origin) => {
      const numberList = origin?.match(/\d+/gim) ?? []
      const nowCn = new Date(Date.now() + 8 * 3600000)
      const currentYear = nowCn.getUTCFullYear()
      let year: number, month: number
      if (numberList.length >= 2) {
        const a = parseInt(numberList[0])
        const b = parseInt(numberList[1])
        if (a >= 100) {
          // 完整年份在前: 2026-10
          year = a; month = b
        } else if (b >= 100) {
          // 完整年份在后: 10-2026
          year = b; month = a
        } else if (b >= 1 && b <= 12) {
          // 两位年份在前: 27-2 → 2027年2月
          year = 2000 + a; month = b
        } else if (a >= 1 && a <= 12) {
          // 两位年份在后: 2-27 → 2027年2月
          year = 2000 + b; month = a
        } else {
          return `错误: 无法识别的日期 "${origin}", 月份应在 1-12 之间\n使用以下指令以查看帮助:\n  help 活动日历`
        }
      } else if (numberList.length == 1) {
        const n = parseInt(numberList[0])
        if (n >= 1 && n <= 12) {
          year = currentYear
          month = n
        } else if (n >= 13 && n <= 99) {
          // 两位年份: 27 → 2027年当月
          year = 2000 + n
          month = nowCn.getUTCMonth() + 1
        } else {
          year = n
          month = nowCn.getUTCMonth() + 1
        }
      } else {
        year = currentYear
        month = nowCn.getUTCMonth() + 1
      }
      if (!(year >= 2015 && year <= 2100) || !(month >= 1 && month <= 12)) {
        return `错误: 年月超出支持范围 (年份 2015-2100, 月份 1-12), 当前输入: ${origin ?? ''}`
      }
      const list = await commandCalendar(config, year, month)
      return paresMessageList(list)
    })

  ctx.command("查卡池 <gachaId:integer>", "查询卡池信息", cmdConfig)
    .usage('根据卡池ID查询卡池信息')
    .action(async ({ session }, gachaId) => {
      if (gachaId == undefined) {
        return `错误: 指令不完整\n使用以下指令以查看帮助:\n  help 查卡池`
      }
      if (!Number.isInteger(gachaId) || gachaId < 1) {
        return '错误: 卡池ID必须为正整数'
      }
      const tsuguUserData = await observeUserTsugu(session)
      const displayedServerList = tsuguUserData.displayedServerList
      const list = await commandGacha(config, displayedServerList, gachaId)
      return paresMessageList(list)
    })

  ctx.command("ycx <tier:integer> [eventId] [serverName]", "查询指定档位的预测线", cmdConfig)
    .usage(`查询指定档位的预测线, 如果没有服务器名的话, 服务器为用户的默认服务器。如果没有活动ID的话, 活动为当前活动\n可用档线:\n:\n${tierListOfServerToString()}`)
    .example('ycx 1000 :返回默认服务器当前活动1000档位的档线与预测线').example('ycx 1000 177 jp:返回日服177号活动1000档位的档线与预测线')
    .action(async ({ session }, tier, eventId, serverName) => {
      if (tier == undefined) {
        return `错误: 指令不完整\n使用以下指令以查看帮助:\n  help ycx`
      }
      // @ts-ignore
      if(isNaN(eventId)) {
        serverName = eventId;
        eventId = undefined;
      }
      if (eventId !== undefined && Number(eventId) < 1) {
        return '错误: 活动ID必须为正整数'
      }
      const tsuguUserData = await observeUserTsugu(session)
      let mainServer: Server = tsuguUserData.mainServer
      if (serverName) {
        const serverFromServerNameFuzzySearch = await serverNameFuzzySearchResult(config, serverName)
        if (serverFromServerNameFuzzySearch == -1) {
          return '错误: 服务器名未能匹配任何服务器'
        }
        mainServer = serverFromServerNameFuzzySearch
      }
      if (!isValidTier(mainServer, tier)) {
        return '错误: 档线无效, 请发送 help ycx 查看可用档线'
      }
      // @ts-ignore
      const list = await commandCutoffDetail(config, mainServer, tier, eventId)
      return paresMessageList(list)
    })
  ctx.command("ycxall [eventId] [serverName]", "查询所有档位的预测线", cmdConfig)
    .usage(`查询所有档位的预测线, 如果没有服务器名的话, 服务器为用户的默认服务器。如果没有活动ID的话, 活动为当前活动\n可用档线:\n${tierListOfServerToString()}`)
    .example('ycxall :返回默认服务器当前活动所有档位的档线与预测线').example('ycxall 177 jp:返回日服177号活动所有档位的档线与预测线')
    .alias('myycx')
    .action(async ({ session }, eventId, serverName) => {
      // @ts-ignore
      if(isNaN(eventId)) {
        serverName = eventId;
        eventId = undefined;
      }
      if (eventId !== undefined && Number(eventId) < 1) {
        return '错误: 活动ID必须为正整数'
      }
      const tsuguUserData = await observeUserTsugu(session)
      let mainServer: Server = tsuguUserData.mainServer
      if (serverName) {
        const serverFromServerNameFuzzySearch = await serverNameFuzzySearchResult(config, serverName)
        if (serverFromServerNameFuzzySearch == -1) {
          return '错误: 服务器名未能匹配任何服务器'
        }
        mainServer = serverFromServerNameFuzzySearch
      }
      // @ts-ignore
      const list = await commandCutoffAll(config, mainServer, eventId)
      return paresMessageList(list)
    })
  ctx.command("lsycx <tier:integer> [eventId] [serverName]", "查询档线与近期同类档线", cmdConfig)
    .usage(`查询指定档位的预测线, 与最近的4期活动类型相同的活动的档线数据, 如果没有服务器名的话, 服务器为用户的默认服务器。如果没有活动ID的话, 活动为当前活动\n可用档线:\n${tierListOfServerToString()}`)
    .example('lsycx 1000 :返回默认服务器当前活动的档线与预测线, 与最近的4期活动类型相同的活动的档线数据').example('lsycx 1000 177 jp:返回日服177号活动1000档位档线与最近的4期活动类型相同的活动的档线数据')
    .action(async ({ session }, tier, eventId, serverName) => {
      if (tier == undefined) {
        return `错误: 指令不完整\n使用以下指令以查看帮助:\n  help lsycx`
      }
      // @ts-ignore
      if(isNaN(eventId)) {
        serverName = eventId;
        eventId = undefined;
      }
      if (eventId !== undefined && Number(eventId) < 1) {
        return '错误: 活动ID必须为正整数'
      }
      const tsuguUserData = await observeUserTsugu(session)
      let mainServer: Server = tsuguUserData.mainServer
      if (serverName) {
        const serverFromServerNameFuzzySearch = await serverNameFuzzySearchResult(config, serverName)
        if (serverFromServerNameFuzzySearch == -1) {
          return '错误: 服务器名未能匹配任何服务器'
        }
        mainServer = serverFromServerNameFuzzySearch
      }
      if (!isValidTier(mainServer, tier)) {
        return '错误: 档线无效, 请发送 help lsycx 查看可用档线'
      }
      // @ts-ignore
      const list = await commandCutoffListOfRecentEvent(config, mainServer, tier, eventId)
      return paresMessageList(list)
    })

  ctx.command('mycx <tier:integer> [monthlyRankingId] [serverName]', '查询指定档位的月榜预测线', cmdConfig)
    .usage(`查询指定档位的月榜预测线；省略月榜 ID 时查询当前月榜\n可用档线:\n${tierListOfServerToString()}`)
    .action(async ({ session }, tier, monthlyRankingId, serverName) => {
      if (tier == undefined) return '错误: 指令不完整\n使用以下指令以查看帮助:\n  help mycx'
      if (monthlyRankingId !== undefined && isNaN(Number(monthlyRankingId))) {
        serverName = monthlyRankingId
        monthlyRankingId = undefined
      }
      if (monthlyRankingId !== undefined && Number(monthlyRankingId) < 1) {
        return '错误: 月榜ID必须为正整数'
      }
      const tsuguUserData = await observeUserTsugu(session)
      let mainServer: Server = tsuguUserData.mainServer
      if (serverName) {
        const matchedServer = await serverNameFuzzySearchResult(config, serverName)
        if (matchedServer == -1) return '错误: 服务器名未能匹配任何服务器'
        mainServer = matchedServer
      }
      if (!isValidTier(mainServer, tier)) {
        return '错误: 档线无效, 请发送 help mycx 查看可用档线'
      }
      const list = await commandMonthlyRankingCutoffDetail(
        config,
        mainServer,
        tier,
        monthlyRankingId === undefined ? undefined : Number(monthlyRankingId),
      )
      return paresMessageList(list)
    })

  ctx.command('mycxall [monthlyRankingId] [serverName]', '查询所有档位的月榜预测线', cmdConfig)
    .usage(`查询所有月榜档位的预测线；省略月榜 ID 时查询当前月榜\n可用档线:\n${tierListOfServerToString()}`)
    .action(async ({ session }, monthlyRankingId, serverName) => {
      if (monthlyRankingId !== undefined && isNaN(Number(monthlyRankingId))) {
        serverName = monthlyRankingId
        monthlyRankingId = undefined
      }
      if (monthlyRankingId !== undefined && Number(monthlyRankingId) < 1) {
        return '错误: 月榜ID必须为正整数'
      }
      const tsuguUserData = await observeUserTsugu(session)
      let mainServer: Server = tsuguUserData.mainServer
      if (serverName) {
        const matchedServer = await serverNameFuzzySearchResult(config, serverName)
        if (matchedServer == -1) return '错误: 服务器名未能匹配任何服务器'
        mainServer = matchedServer
      }
      const list = await commandMonthlyRankingCutoffAll(
        config,
        mainServer,
        monthlyRankingId === undefined ? undefined : Number(monthlyRankingId),
      )
      return paresMessageList(list)
    })

  ctx.command('mlsycx <tier:integer> [monthlyRankingId] [serverName]', '查询近期月榜档线', cmdConfig)
    .usage(`查询指定档位及最近四期月榜档线；省略月榜 ID 时查询当前月榜\n可用档线:\n${tierListOfServerToString()}`)
    .action(async ({ session }, tier, monthlyRankingId, serverName) => {
      if (tier == undefined) return '错误: 指令不完整\n使用以下指令以查看帮助:\n  help mlsycx'
      if (monthlyRankingId !== undefined && isNaN(Number(monthlyRankingId))) {
        serverName = monthlyRankingId
        monthlyRankingId = undefined
      }
      if (monthlyRankingId !== undefined && Number(monthlyRankingId) < 1) {
        return '错误: 月榜ID必须为正整数'
      }
      const tsuguUserData = await observeUserTsugu(session)
      let mainServer: Server = tsuguUserData.mainServer
      if (serverName) {
        const matchedServer = await serverNameFuzzySearchResult(config, serverName)
        if (matchedServer == -1) return '错误: 服务器名未能匹配任何服务器'
        mainServer = matchedServer
      }
      if (!isValidTier(mainServer, tier)) {
        return '错误: 档线无效, 请发送 help mlsycx 查看可用档线'
      }
      const list = await commandMonthlyRankingCutoffListOfRecent(
        config,
        mainServer,
        tier,
        monthlyRankingId === undefined ? undefined : Number(monthlyRankingId),
      )
      return paresMessageList(list)
    })

  ctx.command('ycxmusic <tier:integer> [songIndex] [eventId] [serverName]', '查询歌榜档位预测线', cmdConfig)
    .usage(`查询歌曲排名预测线, 只有档位为必填参数。只有对邦/挑战/组曲类型活动有歌榜:\n  组曲: 显示全部曲目合计榜, 无需指定歌曲\n  对邦: 每服仅一曲, 自动选择\n  挑战: 可传 1/2/3 指定第几首歌, 缺省第1首\n活动ID缺省为当前活动, 服务器缺省为默认服务器。数字参数 1-3 优先视为歌曲序号\ntier=10 时返回前十线`)
    .example('ycxmusic 300: 默认服务器当前活动 歌榜T300')
    .example('ycxmusic 300 2: 当前活动第2首歌 歌榜T300(挑战)')
    .example('ycxmusic 300 320 jp: 日服320号活动 歌榜T300')
    .example('ycxmusic 10: 默认服务器当前活动 歌榜前十线')
    .example('ycxmusic 300 323: 323号活动(组曲)合计榜 T300')
    .action(async ({ session }, tier, songIndex, eventId, serverName) => {
      if (tier == undefined) {
        return '错误: 指令不完整, 需要指定档位\n使用以下指令以查看帮助:\n  help ycxmusic'
      }
      // 参数智能归类: 数字 1-3 且未占用 -> 歌曲序号; 其余正整数 -> 活动ID; 非数字 -> 服务器名
      let musicIndex: number | undefined
      let eventIdNumber: number | undefined
      let serverNameArg: string | undefined
      for (const raw of [songIndex, eventId, serverName]) {
        if (raw === undefined) continue
        const arg = String(raw)
        if (/^\d+$/.test(arg)) {
          const n = Number(arg)
          if (n >= 1 && n <= 3 && musicIndex === undefined) {
            musicIndex = n
          } else if (n >= 1) {
            eventIdNumber = n
          } else {
            return '错误: 活动ID必须为正整数'
          }
        } else {
          serverNameArg = arg
        }
      }
      const tsuguUserData = await observeUserTsugu(session)
      let mainServer: Server = tsuguUserData.mainServer
      if (serverNameArg) {
        const matchedServer = await serverNameFuzzySearchResult(config, serverNameArg)
        if (matchedServer == -1) return '错误: 服务器名未能匹配任何服务器'
        mainServer = matchedServer
      }
      if (!isValidTier(mainServer, tier)) {
        return '错误: 档线无效, 请发送 help ycxmusic 查看可用档线'
      }
      const list = await commandCutOffMusic(
        config,
        mainServer,
        Number(tier),
        musicIndex,
        eventIdNumber,
      )
      return paresMessageList(list)
    })

  ctx.command('抽卡模拟 [times:integer] [gachaId:integer]', '模拟抽卡', cmdConfig)
    .usage('模拟抽卡, 如果没有卡池ID的话, 卡池为当前活动的卡池')
    .example('抽卡模拟:模拟抽卡10次').example('抽卡模拟 300 922 :模拟抽卡300次, 卡池为922号卡池')
    .channelFields(['tsugu_gacha'])
    .action(async ({ session }, times, gachaId) => {
      if (times == undefined) {
        return `错误: 指令不完整\n使用以下指令以查看帮助:\n  help 抽卡模拟`
      }
      if (!Number.isInteger(times) || times < 1 || times > 10000) {
        return '错误: 抽卡次数必须为 1 到 10000 之间的整数'
      }
      if (gachaId != undefined && (!Number.isInteger(gachaId) || gachaId < 1)) {
        return '错误: 卡池ID必须为正整数'
      }
      const status = session.channel?.tsugu_gacha ?? true
      if (status) {
        const tsuguUserData = await observeUserTsugu(session)
        const mainServer = tsuguUserData.mainServer
        const list = await commandGachaSimulate(config, mainServer, times, gachaId)
        return (paresMessageList(list))
      }
      else {
        return '抽卡功能已关闭'
      }
    })
  /*
ctx.on('command/before-execute', (argv) => {
  const { command, session } = argv;
  const now_channel = session.channelId;
  // 其他逻辑代码继续执行
  async function getChannelData() {
    const channel_get = await ctx.database.get('channel', { id: now_channel });
    if (channel_get[0]?.tsugu_run === false) {
      const keywords = ['查询玩家', '查卡面', '查玩家', '查卡', '查角色', '查活动', '查分数表', '查询分数榜', '查分数榜', '查曲', '查谱面', '查卡池', '查询分数表', 'ycx', 'ycxall', 'lsycx', '抽卡模拟', '绑定玩家', '解除绑定', '主服务器', '设置默认服务器', '玩家状态', '开启车牌转发', '关闭车牌转发'];
      const messageContent = session.event.message.content;
      // 检查消息是否以数组中的任意一个词开始
      const startsWithKeyword = keywords.some(keyword => messageContent.startsWith(keyword));
      if (startsWithKeyword) {
        console.log('尝试关闭');
        return '';
      }
    }
  }
  return getChannelData(); // 将结果返回给原始的命令执行过程
});
*/
  // 为bot添加回复/at功能
  ctx.before('send', (session, options) => { // options 包含来自 user 的上文 session
    if (config.at) {
      if (session.elements.length > 0) {
        session.elements.unshift(h('at', { id: options.session.event.user.id }));
      }
    }
    if (config.reply) {
      if (session.elements.length > 0) {
        session.elements.unshift(h('quote', { id: options.session.event.message.id }));
      }
    }
  })
}

const CommandLogger = new Logger('tsugu-command');

export const cmdConfig: Command.Config = {
  checkUnknown: true,
  checkArgCount: false,
  handleError: (err, { command }) => {
    CommandLogger.error(err)
    return `执行指令 ${command.displayName} 失败`;
  },
};
