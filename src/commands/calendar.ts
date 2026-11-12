import { getReplyFromBackend } from "../api/getReplyFromBackend"
import { Config } from '../config';


export async function commandCalendar(config: Config, year?: number, month?: number): Promise<Array<Buffer | string>> {
    return await getReplyFromBackend(`${config.backendUrl}/calendar`, {
        year,
        month,
        compress: config.compress
    })
}
