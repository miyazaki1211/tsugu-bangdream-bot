import { getReplyFromBackend } from "../api/getReplyFromBackend"
import { Config } from '../config';

export async function commandPlayerMusic(config: Config, playerId: number, platform: string, userId: string): Promise<Array<Buffer | string>> {
    return await getReplyFromBackend(`${config.backendUrl}/playerMusic`, {
        playerId,
        platform,
        userId,
        useEasyBG: config.useEasyBG,
        compress: config.compress
    })
}
