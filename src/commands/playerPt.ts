import { getReplyFromBackend } from "../api/getReplyFromBackend"
import { Config } from '../config';

export async function commandPlayerPt(config: Config, playerId: number, platform: string, userId: string): Promise<Array<Buffer | string>> {
    return await getReplyFromBackend(`${config.backendUrl}/playerPt`, {
        playerId,
        platform,
        userId,
        useEasyBG: config.useEasyBG,
        compress: config.compress
    })
}
