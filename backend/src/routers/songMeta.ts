import { drawSongMetaList } from '@/view/songMetaList';
import { Server, getServerByServerId } from '@/types/Server';
import { listToBase64 } from '@/routers/utils';
import { isServer, isServerList } from '@/types/Server';
import { getAvailableSkillDurations, parseDifficultyFilter, DifficultyFilter } from '@/types/Song';
import express from 'express';
import { body } from 'express-validator';
import { middleware } from '@/routers/middleware';
import { Request, Response } from 'express';

const router = express.Router();

router.post('/',
    [
        // Define validation rules for request body
        body('displayedServerList').custom(isServerList),
        body('mainServer').custom(isServer),
        body('compress').optional().isBoolean(),
        body('fever').optional().isBoolean(),
        body('scoreUpMaxValue').optional().isFloat({ min: 0, max: 1000 }),
        body('skillDuration').optional().isFloat({ min: 0.5, max: 20 }),
        body('difficultyFilter').optional().matches(/^([<>])\s*(\d+(\.\d+)?)$/),
    ],
    middleware,
    async (req: Request, res: Response) => {

        const { displayedServerList, mainServer, compress, fever, scoreUpMaxValue, skillDuration, difficultyFilter } = req.body;

        //技能持续时间必须是meta数据中存在的值
        if (skillDuration != undefined && !getAvailableSkillDurations().includes(skillDuration)) {
            return res.send(listToBase64([`错误: 不支持的技能持续时间 ${skillDuration} 秒, 可用值: ${getAvailableSkillDurations().join(', ')}`]));
        }

        //难度过滤参数, 如 '<26' 或 '>20'
        let parsedDifficultyFilter: DifficultyFilter | undefined = undefined;
        if (difficultyFilter != undefined) {
            const parsed = parseDifficultyFilter(difficultyFilter);
            if (parsed == null || !(parsed.value > 0 && parsed.value <= 100)) {
                return res.send(listToBase64(['错误: 难度过滤参数格式只能为 <数字 或 >数字(0到100之间), 如 <26 或 >20']));
            }
            parsedDifficultyFilter = parsed;
        }

        try {
            //默认技能倍率: 带Fever为150, 无Fever为130
            const resolvedFever = fever ?? true;
            const resolvedScoreUpMaxValue = scoreUpMaxValue ?? (resolvedFever ? 150 : 130);
            const result = await commandSongMeta(displayedServerList, getServerByServerId(mainServer), compress, resolvedFever, resolvedScoreUpMaxValue, skillDuration ?? 7, parsedDifficultyFilter);
            res.send(listToBase64(result));
        } catch (e) {
            console.log(e);
            res.status(500).send({ status: 'failed', data: '内部错误' });
        }
    }
);

export async function commandSongMeta(displayedServerList: Server[], mainServer: Server, compress: boolean, fever: boolean = true, scoreUpMaxValue: number = 150, skillDuration: number = 7, difficultyFilter?: DifficultyFilter): Promise<Array<Buffer | string>> {

    if (mainServer == undefined) {
        mainServer = displayedServerList[0]
    }
    return await drawSongMetaList(mainServer, compress, fever, scoreUpMaxValue, skillDuration, difficultyFilter)
}

export { router as songMetaRouter }