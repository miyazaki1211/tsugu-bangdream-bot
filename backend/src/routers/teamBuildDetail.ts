import { Server } from "@/types/Server";
import { listToBase64 } from '@/routers/utils';
import { isServer } from '@/types/Server';
import { getServerByServerId } from '@/types/Server';
import { PlayerDB } from "@/database/playerDB";
import { playerDetail } from "@/types/BuildTypes";
import express from 'express';
import { body } from 'express-validator'; // Import express-validator functions
import { middleware } from '@/routers/middleware';
import { Request, Response } from 'express';
import { getPresentEvent } from '@/types/Event';
import { drawTeamBuildDetail } from "@/view/teamBuildDetail";
import { Player } from "@/types/Player";
import { Stat, Card, addStat, emptyStat } from "@/types/Card";
import { fuzzySearch } from "@/fuzzySearch";
import { matchCardList } from "@/view/cardList";
import mainAPI from "@/types/_Main";
import { AreaItem } from "@/types/AreaItem";
import { PtConfig } from "@/types/BuildTypes";
import axios from 'axios';
import { LOCAL_RANKING_API_URL, USE_LOCAL_RANKING_API } from '@/config';
import { ensureLocalRankingSourceInited } from '@/api/rankingSourceInit';
import { UserDB } from '@/database/userDB';

const router = express.Router();
const playerDB = new PlayerDB(process.env.MONGODB_URI ?? 'mongodb://localhost:27017/', 'tsugu-bangdream-bot')
const userDB = new UserDB(process.env.MONGODB_URI ?? 'mongodb://localhost:27017/', process.env.MONGODB_DATABASE_NAME ?? 'tsugu-bangdream-bot')

router.post('/',
    [
        body('playerId').isInt(), // Validation for 'playerId' field
        body('mainServer').custom(isServer), // Custom validation for 'server' field
        body('eventId').optional().isInt(), // eventId is optional and must be an integer if provided
        body('useEasyBG').isBoolean(), // Validation for 'useEasyBG' field
        body('compress').optional().isBoolean(),
    ],
    middleware,
    async (req: Request, res: Response) => {
        const { playerId, mainServer, eventId, useEasyBG, compress } = req.body;

        try {
            const result = await commandTeamBuildDetail(playerId, getServerByServerId(mainServer), useEasyBG, compress, eventId);
            res.send(listToBase64(result));
        } catch (e) {
            console.log(e);
            res.status(500).send({ status: 'failed', data: '内部错误' });
        }
    }
);

router.post('/importPlayerData',
    [
        body('playerId').isInt(), // Validation for 'playerId' field
        body('mainServer').custom(isServer), // Custom validation for 'server' field
        body('useEasyBG').isBoolean(), // Validation for 'useEasyBG' field
        body('compress').optional().isBoolean(),
    ],
    middleware,
    async (req: Request, res: Response) => {
        const { playerId, mainServer, useEasyBG, compress } = req.body;
        const player = new Player(playerId, mainServer)
        await player.initFull(false, 2)
        if (player.initError || !player.isExist) {
            res.send(listToBase64([`错误: 查询玩家时发生错误`]));
            return
        }

        const cardList = player.profile.mainDeckUserSituations.entries.map((card) => {
            return {
                id: card.situationId,
                illustTrainingStatus: card.illust == "after_training",
                limitBreakRank: card.limitBreakRank,
                skillLevel: card.skillLevel
            }
        })
        await playerDB.addCard(playerId, cardList)

        const characterBounsList = player.profile.mainDeckUserSituations.entries.map((data) => {
            const card = new Card(data.situationId), append = data.userAppendParameter
            const base: Stat = {
                performance: append.performance,
                technique: append.technique,
                visual: append.visual
            }
            addStat(base, card.stat[card.getMaxLevel().toString()])
            const potential: Stat = {
                performance: Math.ceil(1000 * (append.characterPotentialPerformance || 0) / base.performance) / 1000,
                technique: Math.ceil(1000 * (append.characterPotentialTechnique || 0) / base.technique) / 1000,
                visual: Math.ceil(1000 * (append.characterPotentialVisual || 0) / base.visual) / 1000,
            }, characterTask: Stat = {
                performance: Math.ceil(1000 * (append.characterBonusPerformance || 0) / base.performance) / 1000,
                technique: Math.ceil(1000 * (append.characterBonusTechnique || 0) / base.technique) / 1000,
                visual: Math.ceil(1000 * (append.characterBonusVisual || 0) / base.visual) / 1000,
            }
            return {
                characterId: card.characterId,
                potential,
                characterTask
            }
        })
        await playerDB.updateCharacterBouns(playerId, characterBounsList)

        if (!player.profile.enabledUserAreaItems) {
            res.send(listToBase64(['无法获取区域道具信息，请公开显示主乐队综合能力']))
            return
        }
        const areaItemList = player.profile.enabledUserAreaItems.entries.map((item) => {
            return {
                id: item.areaItemCategory,
                level: item.level
            }
        })
        await playerDB.updateAreaItem(playerId, areaItemList)

        try {
            // 透传玩家已选活动，避免默认"当前活动"覆盖 player.currentEvent（否则后续 PT计算 会算错活动）
            const existingPlayer = await playerDB.getPlayer(playerId);
            const result = await commandTeamBuildDetail(playerId, getServerByServerId(mainServer), useEasyBG, compress, existingPlayer?.currentEvent);
            res.send(listToBase64(result));
        } catch (e) {
            console.log(e);
            res.status(500).send({ status: 'failed', data: '内部错误' });
        }
    }
)

router.post('/importAllPlayerData',
    [
        body('playerId').isInt(), // Validation for 'playerId' field
        body('mainServer').custom(isServer), // Custom validation for 'server' field
        body('useEasyBG').isBoolean(), // Validation for 'useEasyBG' field
        body('compress').optional().isBoolean(),
        body('platform').isString(),
        body('userId').isString(),
    ],
    middleware,
    async (req: Request, res: Response) => {
        const { playerId, mainServer, useEasyBG, compress, platform, userId } = req.body;

        if (!LOCAL_RANKING_API_URL) {
            res.send(listToBase64(['错误: 导入全部配置功能未启用（未配置本地数据源）']));
            return;
        }
        await ensureLocalRankingSourceInited();
        if (!USE_LOCAL_RANKING_API) {
            res.send(listToBase64(['错误: 本地数据源不可用，无法导入全部配置']));
            return;
        }

        // 本人凭据 (B站扫码获得) 按用户存储在数据库中
        const user = await userDB.getUser(platform, userId);
        const channelUid = user?.channelUid ?? '';
        const channelToken = user?.channelToken ?? '';
        if (!channelUid || !channelToken) {
            res.send(listToBase64(['错误: 尚未设置令牌，请私信我发送 设置令牌 扫码完成配置']));
            return;
        }

        // 1. 调用本地 GarupaSpeedTracker playerCards 接口（全量卡牌库存 + 区域道具 + 角色加成）
        const server = getServerByServerId(mainServer);
        const baseUrl = LOCAL_RANKING_API_URL.replace(/\/+$/, '');
        let response;
        try {
            const params: Record<string, unknown> = { server, playerId, channelUid, channelToken };
            // 已存储平台时显式传入, 跳过 tracker 的双平台登录探测; 未存时省略, 由响应回传后写库
            if (user?.tokenPlatform) {
                params.platform = user.tokenPlatform;
            }
            response = await axios.get(`${baseUrl}/api/playerCards`, {
                params: params,
                timeout: 60000,
                proxy: false,
            });
        } catch (error) {
            if (axios.isAxiosError(error) && error.response) {
                const msg = (error.response.data as { message?: string })?.message;
                const status = error.response.status;
                if (status == 405) {
                    res.send(listToBase64(['错误: 令牌无效或已过期，请在私信中重新发送 设置令牌 扫码配置']));
                    return;
                }
                res.send(listToBase64([msg ? `错误: 查询玩家数据失败（${status} ${msg}）` : `错误: 查询玩家数据失败（${status}）`]));
            } else {
                res.send(listToBase64(['错误: 无法连接本地数据源，请稍后再试']));
            }
            return;
        }

        // tracker 未存平台时会自动探测并在响应中回传, 写回数据库供下次显式传入跳过探测
        const apiPlatform = (response.data as { platform?: string })?.platform;
        if (apiPlatform && apiPlatform != user?.tokenPlatform) {
            try {
                await userDB.updateUser(platform, userId, { tokenPlatform: apiPlatform });
            }
            catch (e) {
            }
        }

        const data = response.data?.data;
        if (!data || !Array.isArray(data.cards)) {
            res.send(listToBase64(['错误: 数据源返回格式异常']));
            return;
        }

        // 2. 卡牌库存（trainingStatus 'done' = 已特训）— 全量替换: 先清空玩家现有卡牌, 再写入数据源全部卡牌
        const cardList = data.cards.map((card: { situationId: number; trainingStatus?: string; limitBreakRank: number; skillLevel: number }) => {
            return {
                id: card.situationId,
                illustTrainingStatus: card.trainingStatus === 'done',
                limitBreakRank: card.limitBreakRank,
                skillLevel: card.skillLevel
            };
        });
        await playerDB.clearCard(playerId);
        await playerDB.addCard(playerId, cardList);

        // 3. 角色加成（数据源下发百分比数值，库内存储比率，故除以 100）
        const characterBounsList = (data.characters ?? []).map((c: {
            characterId: number;
            potentialBonusPercent?: { performance?: number; technique?: number; visual?: number };
            missionBonusPercent?: { performance?: number; technique?: number; visual?: number };
        }) => {
            return {
                characterId: c.characterId,
                potential: {
                    performance: (c.potentialBonusPercent?.performance ?? 0) / 100,
                    technique: (c.potentialBonusPercent?.technique ?? 0) / 100,
                    visual: (c.potentialBonusPercent?.visual ?? 0) / 100
                },
                characterTask: {
                    performance: (c.missionBonusPercent?.performance ?? 0) / 100,
                    technique: (c.missionBonusPercent?.technique ?? 0) / 100,
                    visual: (c.missionBonusPercent?.visual ?? 0) / 100
                }
            };
        });
        await playerDB.updateCharacterBouns(playerId, characterBounsList);

        // 4. 区域道具（数据源的 category 即 saaya 的 areaItemCategory id）
        const areaItemList = (data.areaItems ?? []).map((item: { category: number; level: number }) => {
            return {
                id: item.category,
                level: item.level
            };
        });
        await playerDB.updateAreaItem(playerId, areaItemList);

        try {
            // 透传玩家已选活动，避免默认"当前活动"覆盖 player.currentEvent（否则后续 PT计算 会算错活动）
            const existingPlayer = await playerDB.getPlayer(playerId);
            const result = await commandTeamBuildDetail(playerId, server, useEasyBG, compress, existingPlayer?.currentEvent);
            res.send(listToBase64(result));
        } catch (e) {
            res.status(500).send({ status: 'failed', data: '内部错误' });
        }
    }
)

router.post('/updateSong',
    [
        body('playerId').isInt(), // Validation for 'playerId' field
        body('mainServer').custom(isServer), // Custom validation for 'server' field
        body('id').isInt(),
        body('songId').isInt(),
        body('difficulty').isInt()
    ],
    middleware,
    async (req: Request, res: Response) => {
        const { playerId, mainServer, id, songId, difficulty } = req.body;
        if (id != -1 && !(id & 7)) {
            res.send(listToBase64(['错误：歌曲位置无效, 应为 1/2/3 的组合或 all']));
            return
        }
        let player: playerDetail = await playerDB.getPlayer(playerId)
        const eventId = player?.currentEvent
        if (!eventId) {
            res.send(listToBase64(['未选择活动，请发送 组队计算+活动id']))
            return
        }
        // 当前活动缺歌曲条目时先按默认初始化（防止 eventSongs[eventId] 为 undefined 导致崩溃）
        if (!player.eventSongs?.[eventId]?.length) {
            player = await playerDB.updCurrentEvent(playerId, getServerByServerId(mainServer), eventId)
        }
        if (!player.eventSongs?.[eventId]?.length) {
            res.send(listToBase64(['错误：当前活动没有可用的歌曲数据，无法选择歌曲']));
            return
        }
        await playerDB.updateSong(playerId, eventId, id, songId, difficulty)
        let slotsText: string
        if (id == -1) {
            slotsText = '全部'
        }
        else {
            const slots: number[] = []
            for (let i = 0; i < 3; i++) {
                if (id >> i & 1) slots.push(i + 1)
            }
            slotsText = '第' + slots.join('、') + '首'
        }
        const diffText = ['ez', 'nm', 'hd', 'ex', 'sp'][difficulty] ?? `${difficulty}`
        res.send(listToBase64([`已设置${slotsText}歌曲为: ${songId} ${diffText}`]));
    }
)


router.post('/resetSong',
    [
        body('playerId').isInt(), // Validation for 'playerId' field
        body('mainServer').custom(isServer), // Custom validation for 'server' field
    ],
    middleware,
    async (req: Request, res: Response) => {
        const { playerId, mainServer } = req.body;
        let player: playerDetail = await playerDB.getPlayer(playerId)
        const eventId = player?.currentEvent
        if (!eventId) {
            res.send(listToBase64(['未选择活动，请发送 组队计算+活动id']))
            return
        }
        await playerDB.resetSong(playerId, getServerByServerId(mainServer), eventId)
        res.send(listToBase64(['歌曲已重置为当期活动默认曲目']));
    }
)

router.post('/levelUp',
    [
        body('playerId').isInt(), // Validation for 'playerId' field
        body('mainServer').custom(isServer), // Custom validation for 'server' field
    ],
    middleware,
    async (req: Request, res: Response) => {
        const { playerId, mainServer } = req.body;

        const areaItemList = Object.keys(mainAPI['areaItems']).map((areaItemId) => {
            const item = new AreaItem(parseInt(areaItemId))
            return {
                id: areaItemId,
                level: item.level[mainServer]
            }
        })
        await playerDB.updateAreaItem(playerId, areaItemList)

        const characterBounsList = Object.keys(mainAPI['characters']).map((characterId) => {
            return {
                characterId,
                // 国服潜能上限 5.5% (2026-09 上调, 原 5%); 任务加成上限仍为 6%
                potential: {
                    performance: 0.055,
                    technique: 0.055,
                    visual: 0.055
                },
                characterTask: {
                    performance: 0.06,
                    technique: 0.06,
                    visual: 0.06
                }
            }
        })
        await playerDB.updateCharacterBouns(playerId, characterBounsList)

        res.send(listToBase64(['区域道具与角色加成已升至当前服务器最高等级']));
    }
)

router.post('/levelReset',
    [
        body('playerId').isInt(), // Validation for 'playerId' field
        body('mainServer').custom(isServer), // Custom validation for 'server' field
    ],
    middleware,
    async (req: Request, res: Response) => {
        const { playerId } = req.body;

        const areaItemList = Object.keys(mainAPI['areaItems']).map((areaItemId) => {
            const item = new AreaItem(parseInt(areaItemId))
            return {
                id: areaItemId,
                level: 0
            }
        })
        await playerDB.updateAreaItem(playerId, areaItemList)

        const characterBounsList = Object.keys(mainAPI['characters']).map((characterId) => {
            return {
                characterId,
                potential: emptyStat(),
                characterTask: emptyStat()
            }
        })
        await playerDB.updateCharacterBouns(playerId, characterBounsList)

        res.send(listToBase64(['区域道具与角色加成等级已重置为0']));
    }
)

router.post('/addCard',
    [
        body('playerId').isInt(), // Validation for 'playerId' field
        body('mainServer').custom(isServer), // Custom validation for 'server' field
        body('skill_level').isInt(),
        body('break_rank').isInt(),
        body('text').isString(),
    ],
    middleware,
    async (req: Request, res: Response) => {
        const { playerId, skill_level, break_rank, text } = req.body;

        const matched = matchCardList(fuzzySearch(text), [3, 0])
        if (matched.length == 0) {
            res.send(listToBase64(['未找到匹配的卡牌']));
            return
        }
        const cardList = matched.map((card) => {
            return {
                id : card.cardId,
                illustTrainingStatus: true,
                limitBreakRank: break_rank,
                skillLevel: skill_level
            }
        })
        await playerDB.addCard(playerId, cardList)

        res.send(listToBase64([`已添加 ${cardList.length} 张卡牌 (技能等级${skill_level}, 突破${break_rank})`]));
    }
)

router.post('/delCard',
    [
        body('playerId').isInt(), // Validation for 'playerId' field
        body('mainServer').custom(isServer), // Custom validation for 'server' field
        body('text').isString(),
    ],
    middleware,
    async (req: Request, res: Response) => {
        const { playerId, text } = req.body;
        const cardList = matchCardList(fuzzySearch(text), [3, 0]).map((card) => {
            return card.cardId
        })
        if (cardList.length == 0) {
            res.send(listToBase64(['未找到匹配的卡牌']));
            return
        }
        await playerDB.delCard(playerId, cardList)

        res.send(listToBase64([`已删除 ${cardList.length} 张卡牌`]));
    }
)


router.post('/updatePtConfig',
    [
        body('playerId').isInt(),
        body('mainServer').custom(isServer),
        body('teammateStat').optional().isInt({ min: 0, max: 420000 }),
        body('leaderScoreUpRaw').optional().isInt({ min: 10, max: 170 }),
        body('leaderSkillDuration').optional().isInt({ min: 5, max: 8 }),
        body('teamRankInput').optional().isInt({ min: 1, max: 5 }),
        body('festivalWon').optional().isBoolean(),
        body('supportStat').optional().isInt({ min: 0, max: 400000 }),
    ],
    middleware,
    async (req: Request, res: Response) => {
        const { playerId, teammateStat, leaderScoreUpRaw, leaderSkillDuration, teamRankInput, festivalWon, supportStat } = req.body;

        const update: Partial<PtConfig> = {};
        if (teammateStat !== undefined) update.teammateStat = teammateStat;
        if (leaderScoreUpRaw !== undefined) update.leaderScoreUpRaw = leaderScoreUpRaw;
        if (leaderSkillDuration !== undefined) update.leaderSkillDuration = leaderSkillDuration;
        if (teamRankInput !== undefined) update.teamRankInput = teamRankInput;
        if (festivalWon !== undefined) update.festivalWon = festivalWon;
        if (supportStat !== undefined) update.supportStat = supportStat;

        if (Object.keys(update).length === 0) {
            res.send(listToBase64(['未提供任何参数，可用参数: -z 队友综合力 -s 技能倍率 -t 持续时间 -r 排名 -w 输赢 -b 支援综合力']));
            return;
        }

        await playerDB.updatePtConfig(playerId, update)

        const labels: Record<string, string> = {
            teammateStat: '队友综合力',
            leaderScoreUpRaw: '技能倍率',
            leaderSkillDuration: '持续时间',
            teamRankInput: '排名',
            festivalWon: '输赢',
            supportStat: '支援综合力',
        }
        const changed = Object.keys(update).map(k => `${labels[k]}=${update[k]}`).join(', ')
        res.send(listToBase64([`PT参数已更新: ${changed}`]));
    }
)


export async function commandTeamBuildDetail(playerId: number, mainServer: Server, useEasyBG: boolean, compress: boolean, eventId?: number)/*: Promise<Array<Buffer | string>>*/ {
    let player :playerDetail  = await playerDB.getPlayer(playerId)
    // 不指定活动时，默认为当前活动
    const currentEvent = eventId ?? getPresentEvent(mainServer).eventId
    if (currentEvent != player.currentEvent || !player.eventSongs[currentEvent]) {
        player = await playerDB.updCurrentEvent(playerId, mainServer, currentEvent)
    }
    return await drawTeamBuildDetail(player, mainServer, useEasyBG, compress)
}


export { router as teamBuildDetailRouter }