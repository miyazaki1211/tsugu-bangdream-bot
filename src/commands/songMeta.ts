import { Server, getServerByName } from '../types/Server'
import { getReplyFromBackend } from "../api/getReplyFromBackend"
import { Config } from '../config';

export async function commandSongMeta(config: Config, displayedServerList: Server[], mainServer: Server, fever: boolean = true, scoreUpMaxValue: number = 150, skillDuration: number = 7, difficultyFilter?: string): Promise<Array<Buffer | string>> {
    return await getReplyFromBackend(`${config.backendUrl}/songMeta`, {
        displayedServerList,
        mainServer,
        fever,
        scoreUpMaxValue,
        skillDuration,
        difficultyFilter,
        compress: config.compress
    })
}   
