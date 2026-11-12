import express from 'express';
import { body } from 'express-validator';
import { Request, Response } from 'express';
import { middleware } from '@/routers/middleware';
import { listToBase64 } from '@/routers/utils';
import { isServer, Server, getServerByServerId } from '@/types/Server';
import { getPresentEvent } from '@/types/Event';
import { Event } from '@/types/Event';
import { Song } from '@/types/Song';
import { serverNameFullList } from '@/config';
import { drawMusicRankingCutoffDetail } from '@/view/musicRankingCutoffDetail';
import { drawMusicRankingCutoffTop } from '@/view/musicRankingCutoffTop';

const router = express.Router();

router.post(
    '/',
    [
        body('mainServer').custom(isServer),
        body('tier').isInt(),
        body('eventId').optional().isInt(),
        body('musicIndex').optional().isInt({ min: 1 }),
        body('compress').optional().isBoolean(),
    ],
    middleware,
    async (req: Request, res: Response) => {
        const { mainServer, tier, eventId, musicIndex, compress } = req.body;
        try {
            const result = await commandCutOffMusic(
                getServerByServerId(mainServer),
                tier,
                compress,
                musicIndex,
                eventId
            );
            res.send(listToBase64(result));
        } catch (e) {
            console.log(e);
            res.status(500).send({ status: 'failed', data: '内部错误' });
        }
    }
);

/** 生成活动歌榜曲目清单文案(序号越界时提示用户可选歌曲) */
function eventMusicListText(musics: { musicId: number }[], server: Server): string {
    return musics
        .map((m, i) => {
            const song = new Song(m.musicId);
            if (!song.isExist) {
                return `第${i + 1}首: ID ${m.musicId}`;
            }
            const title = song.musicTitle?.[server] ?? song.musicTitle?.[Server.jp] ?? `ID ${m.musicId}`;
            return `第${i + 1}首: ${title}`;
        })
        .join('\n');
}

export async function commandCutOffMusic(
    mainServer: Server,
    tier: number,
    compress: boolean,
    musicIndex?: number,
    eventId?: number
): Promise<Array<Buffer | string>> {
    if (!tier) {
        return ['请输入排名'];
    }
    if (!eventId) {
        eventId = getPresentEvent(mainServer).eventId;
    }

    const event = new Event(eventId);
    if (!event.isExist) {
        return [`错误: 活动${eventId}不存在`];
    }
    await event.initFull();
    const musics = event.musics?.[mainServer];
    if (!musics || musics.length === 0) {
        return [`错误: 活动${eventId}在${serverNameFullList[mainServer]}没有歌榜数据`];
    }

    const index = musicIndex ?? 1;
    if (event.eventType !== 'medley' && index > musics.length) {
        return [
            `错误: 活动${eventId}在${serverNameFullList[mainServer]}的歌榜共${musics.length}首歌\n${eventMusicListText(musics, mainServer)}`
        ];
    }
    const musicId = event.eventType === 'medley' ? 1 : musics[index - 1].musicId;

    if (tier == 10) {
        return await drawMusicRankingCutoffTop(eventId, mainServer, compress, musicId);
    }
    return await drawMusicRankingCutoffDetail(eventId, tier, mainServer, compress, musicId);
}

export { router as cutOffMusicRouter };
