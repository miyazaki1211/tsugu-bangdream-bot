import { getReplyFromBackend } from "../api/getReplyFromBackend"
import { Config } from '../config';

//查广告位: 国服活动 PT 榜各档位广告位玩家, eventId 省略时后端默认取当前活动
export async function commandEventBorderPlayers(config: Config, eventId?: number): Promise<Array<Buffer | string>> {
    return await getReplyFromBackend(`${config.backendUrl}/eventBorderPlayers`, {
        eventId,
        useEasyBG: config.useEasyBG,
        compress: config.compress
    })
}

//查歌榜广告位: 国服活动歌榜各档位广告位玩家, 仅 CP/组曲/对邦 活动有歌榜, eventId 省略时后端默认取当前活动
export async function commandMusicBorderPlayers(config: Config, eventId?: number): Promise<Array<Buffer | string>> {
    return await getReplyFromBackend(`${config.backendUrl}/musicBorderPlayers`, {
        eventId,
        useEasyBG: config.useEasyBG,
        compress: config.compress
    })
}

//查月榜广告位: 国服月榜各档位广告位玩家, monthlyId 省略时上游默认取当前月榜
export async function commandMonthlyBorderPlayers(config: Config, monthlyId?: number): Promise<Array<Buffer | string>> {
    return await getReplyFromBackend(`${config.backendUrl}/monthlyBorderPlayers`, {
        monthlyId,
        useEasyBG: config.useEasyBG,
        compress: config.compress
    })
}
