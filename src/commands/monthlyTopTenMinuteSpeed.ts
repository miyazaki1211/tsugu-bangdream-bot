import { Server } from "../types/Server";
import { getReplyFromBackend } from "../api/getReplyFromBackend"
import { Config } from '../config';

export async function commandMonthlyTopTenMinuteSpeed(config: Config, mainServer: Server, time: number, date: Date, allPlayer: boolean): Promise<Array<Buffer | string>> {
    return await getReplyFromBackend(`${config.backendUrl}/monthlyTopTenMinuteSpeed`, {
        mainServer,
        compress: config.compress,
        time,
        date: date?.getTime(),
        allPlayer,
    })
}
