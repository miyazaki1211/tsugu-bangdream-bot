import { Event } from '@/types/Event';
import { Card } from '@/types/Card'
import { drawList, drawListByServerList, drawListMerge, drawListTextWithImages } from '@/components/list';
import { drawDottedLine } from '@/image/dottedLine'
import { drawDatablock } from '@/components/dataBlock'
import { Image, Canvas } from 'skia-canvas'
import { drawAttributeInList } from '@/components/list/attribute'
import { drawCharacterInList } from '@/components/list/character'
import { statConfig } from '@/components/list/stat'
import { Server } from '@/types/Server';
import { drawTitle } from '@/components/title'
import { outputFinalBuffer } from '@/image/output'
import { Song } from '@/types/Song'
import { drawSongInListBig } from '@/components/list/song';
import { resizeImage, stackImage, stackImageHorizontal } from '@/components/utils';
import { drawCardIcon } from '@/components/card'
import { playerDetail, medleyLimit, limit, checkCard } from '@/types/BuildTypes';
import { drawText } from '@/image/text';
import { AreaItemType, AreaItemTypeList } from '@/types/AreaItem';
import { Band } from '@/types/Band';
import { Attribute } from '@/types/Attribute'
import mainAPI from '@/types/_Main';
import { Character } from '@/types/Character';
import { drawRoundedRectWithText } from '@/image/drawRect';
import { perfMark } from '@/logger';
export async function drawTeamBuildDetail(player: playerDetail, server: Server, useEasyBG: boolean, compress: boolean) {
    const event = new Event(player.currentEvent)
    if (!event.isExist) {
        return ['错误: 活动不存在']
    }
    let defaultServer: Server = server
    if (!event.startAt[defaultServer]) {
        defaultServer = Server.jp
    }
    const perf = perfMark(`drawTeamBuildDetail e${player.currentEvent} ${Server[server]}`)
    await event.initFull()
    perf('活动数据获取')
    var list: Array<Image | Canvas> = []
    const widthMax = 1200, line: Canvas = drawDottedLine({
        width: widthMax,
        height: 30,
        startX: 5,
        startY: 15,
        endX: widthMax - 5,
        endY: 15,
        radius: 2,
        gap: 10,
        color: "#a8a8a8"
    })

    //bannner
    var eventBannerImage = await event.getBannerImage()
    list.push(resizeImage({
        image: eventBannerImage,
        widthMax
    }))
    list.push(new Canvas(widthMax, 30))

    //标题
    list.push(await drawListByServerList(event.eventName, '活动名称', [defaultServer], widthMax))
    list.push(line)

    //类型
    var typeImage = drawList({
        key: '类型', text: event.getTypeName(), maxWidth: widthMax
    })

    //活动ID
    var IdImage = drawList({
        key: 'ID', text: event.eventId.toString(), maxWidth: widthMax
    })

    list.push(drawListMerge([typeImage, IdImage], widthMax))
    list.push(line)

    //活动属性加成
    var attributeImage = []
    attributeImage.push(drawList({
        key: '活动加成'
    }))
    var attributeList = event.getAttributeList()
    for (const i in attributeList) {
        if (Object.prototype.hasOwnProperty.call(attributeList, i)) {
            const element = attributeList[i];
            attributeImage.push(await drawAttributeInList({
                content: element,
                text: ` +${i}%`
            }))
        }
    }

    //活动角色加成
    var characterImage = []
    characterImage.push(drawList({
        key: '活动角色加成'
    }))
    var characterList = event.getCharacterList()
    for (const i in characterList) {
        if (Object.prototype.hasOwnProperty.call(characterList, i)) {
            const element = characterList[i];
            characterImage.push(await drawCharacterInList({
                content: element,
                text: ` +${i}%`
            }))
        }
    }

    //活动偏科加成(stat)
    var statText = ''
    for (const i in event.eventCharacterParameterBonus) {
        if (i == 'eventId') {
            continue
        }
        if (Object.prototype.hasOwnProperty.call(event.eventCharacterParameterBonus, i)) {
            const element = event.eventCharacterParameterBonus[i];
            if (element == 0) {
                continue
            }
            statText += `${statConfig[i].name} + ${element}%  `
        }
    }
    var statImage = drawList({
        key: '活动偏科加成',
        text: statText
    })
    list.push(drawListMerge([stackImage(attributeImage), stackImage(characterImage), undefined, statImage], widthMax))
    list.push(line)
    
    //成员加成
    list.push(drawList({
        key: '活动成员加成'
    }))
    var cardList = event.getMemberList()
    for (const i in cardList) {
        if (Object.prototype.hasOwnProperty.call(cardList, i)) {
            // const element = cardList[i];
            const cardIconList = []
            for (const card of cardList[i]) {
                cardIconList.push(await drawCardIcon({
                    card,
                    cardIdVisible: true,
                    skillTypeVisible: true,
                    cardTypeVisible: true,
                    trainingStatus: false
                }))
            }
            cardIconList.push(`  +${i}%`)
            list.push(drawListTextWithImages({
                content: cardIconList,
                maxWidth: widthMax
            }))
        }
    }
    
    var listImage = drawDatablock({ list })
    //创建最终输出数组

    var all = []
    all.push(drawTitle('查询', '活动'))

    all.push(listImage)

    //选择歌曲 (未设置时默认当期歌曲)
    let songList = player.eventSongs[player.currentEvent]
    if (!songList || songList.length == 0) {
        songList = []
        const serverMusics = event.musics?.[defaultServer]?.length
            ? event.musics[defaultServer]
            : event.musics?.find((m) => m && m.length > 0)
        for (const element of serverMusics ?? []) {
            const song = new Song(element.musicId)
            songList.push({ songId: song.songId, difficulty: song.getMaxMetaDiffId() })
        }
    }
    const songImage = []
    for (const { songId, difficulty } of songList) {
        songImage.push(await drawSongInListBig(new Song(songId), difficulty))
    }
    // 协力歌曲 (PT计算使用)，内容格式与选择歌曲一致 (组曲不显示，无需渲染)
    const ptSongImage: Canvas | null = (player.ptSong && event.eventType != 'medley')
        ? await drawSongInListBig(new Song(player.ptSong.songId), player.ptSong.difficulty)
        : null
    if (event.eventType == 'medley') {
        // 组曲: 原版显示，选择歌曲独占整行，不显示协力歌曲
        const songsRow: Canvas = songImage.length > 0
            ? drawListMerge(songImage, widthMax, true, "bottom")
            : drawList({ key: '歌曲', text: '暂无歌曲数据' })
        all.push(drawDatablock({
            topLeftText: '选择歌曲',
            list: [songsRow]
        }))
    }
    else if (event.eventType == 'versus' || event.eventType == 'challenge') {
        // 对邦/CP: 左侧选择歌曲(原版)，右侧协力歌曲，两侧等宽对称
        const halfWidth = 500
        let songsRow: Canvas
        if (songImage.length == 0) {
            songsRow = drawList({ key: '歌曲', text: '暂无歌曲数据', maxWidth: halfWidth })
        }
        else if (songImage.length == 1 && !ptSongImage) {
            // 无协力歌曲时保持原版全宽
            songsRow = drawListMerge(songImage, widthMax, true, "bottom")
        }
        else if (songImage.length == 1) {
            songsRow = drawListMerge(songImage, halfWidth, true, "bottom")
        }
        else {
            // 多首歌：合并后按需缩放 (仅在并排显示协力歌曲时缩至半宽)
            const merged = drawListMerge(songImage, widthMax, true, "bottom")
            songsRow = ptSongImage ? resizeImage({ image: merged, widthMax: halfWidth }) : merged
        }
        const selectBlock = drawDatablock({
            topLeftText: '选择歌曲',
            list: [songsRow]
        })
        if (ptSongImage) {
            const ptSongBlock = drawDatablock({
                topLeftText: '协力歌曲',
                list: [drawListMerge([ptSongImage], halfWidth, true, "bottom")]
            })
            all.push(stackImageHorizontal([selectBlock, ptSongBlock]))
        }
        else {
            all.push(selectBlock)
        }
    }
    else if (ptSongImage) {
        // 其他活动类型: 只显示协力歌曲
        all.push(drawDatablock({
            topLeftText: '协力歌曲',
            list: [drawListMerge([ptSongImage], widthMax, true, "bottom")]
        }))
    }

    //卡牌列表
    const cardIconList = []
    for (const cardId in player.cardList) {
        const { illustTrainingStatus, limitBreakRank, skillLevel } = player.cardList[cardId]
        cardIconList.push(await drawCardIcon({
            card: new Card(parseInt(cardId)),
            trainingStatus: true,
            illustTrainingStatus: illustTrainingStatus,
            limitBreakRank,
            cardIdVisible: true,
            skillTypeVisible: true,
            cardTypeVisible: false,
            skillLevel
        }))
    }
    const cardIconListInList = [], rowMax = 6
    for (var i = 0; i < cardIconList.length && i < limit; i += rowMax) {
        cardIconListInList.push(drawListTextWithImages({
            content: cardIconList.slice(i, i + rowMax),
            spacing: 16,
            maxWidth: widthMax
        }))
    }
    let msg = checkCard(player, event.eventType, cardIconList.length)
    if (msg.length > 0) {
        cardIconListInList.push(drawText({
            text: msg,
            maxWidth: widthMax
        }))
    }
    all.push(drawDatablock({
        topLeftText: '卡牌列表',
        list: cardIconListInList,
        maxWidth: widthMax
    }))

    //区域道具加成
    const areaItemList = [], areaItemPercent = player.getAreaItemPercent()
    for (const key in areaItemPercent) {
        areaItemList.push(drawList({
            key: AreaItemTypeList[key],
            maxWidth: widthMax
        }))
        const list = []
        let rowMax
        switch (parseInt(key)) {
            case AreaItemType.band:
                for (const bandId in areaItemPercent[key]) {
                    const content = []
                    content.push(bandId == '1000' ? drawText({
                        text: '全部乐队',
                        maxWidth: widthMax
                    }) : resizeImage({
                        image: await (new Band(parseInt(bandId))).getLogo(),
                        heightMax: 80
                    }))
                    content.push(` +${Math.round(areaItemPercent[key][bandId].stat.performance * 10000) / 100}%`)
                    list.push(drawListTextWithImages({
                        content,
                        maxWidth: widthMax
                    }))
                }
                rowMax = 3
                break
            case AreaItemType.attribute:
                const keys = Object.keys(areaItemPercent[key])
                keys.sort()
                for (const attribute of keys) {
                    const content = []
                    content.push(attribute == '~all' ? drawText({
                        text: '全部颜色',
                        maxWidth: widthMax
                    }) : resizeImage({
                        image: await (new Attribute(attribute)).getIcon(),
                        heightMax: 40
                    }))
                    content.push(` +${Math.round(areaItemPercent[key][attribute].stat.performance * 10000) / 100}%`)
                    list.push(drawListTextWithImages({
                        content,
                        lineSpacing: 40,
                        maxWidth: widthMax
                    }))
                }
                rowMax = 4
                break
            case AreaItemType.magazine:
                for (const stat in areaItemPercent[key]) {
                    const text = `${statConfig[stat].name} +${Math.round(areaItemPercent[key][stat].stat[stat] * 10000) / 100}%`
                    list.push(drawList({
                        text,
                        lineSpacing: 40,
                        maxWidth: widthMax
                    }))
                }
                rowMax = 3
                break
        }
        for (var i = 0; i < list.length; i += rowMax) {
            const tmplist = list.slice(i, i + rowMax)
            areaItemList.push(drawListMerge(tmplist, widthMax, false, "center"))
        }
        areaItemList.push(line)
    }
    areaItemList.pop()
    all.push(drawDatablock({
        topLeftText: '区域道具加成',
        list: areaItemList
    }))

    //角色加成

    const characterBounsList = []
    {
        const canvas = new Canvas(widthMax, 100)
        const ctx = canvas.getContext("2d")
        ctx.drawCanvas(drawRoundedRectWithText({
            text: `演出`,
            textSize: 40,
            height: 60,
            color: "#E675A0"
        }), 130, 0)
        ctx.drawCanvas(drawRoundedRectWithText({
            text: `技巧`,
            textSize: 40,
            height: 60,
            color: "#6EB8E7"
        }), widthMax / 3 + 130, 0)
        ctx.drawCanvas(drawRoundedRectWithText({
            text: `形象`,
            textSize: 40,
            height: 60,
            color: "#F6C964"
        }), widthMax / 3 * 2 + 130, 0)
        const list = [], rowMax = 5, iconWidth = 50, height = 150, spacing = 5, bouns = player.characterBouns, width = widthMax / rowMax
        for (const i in mainAPI['characters']) {
            const character = new Character(parseInt(i))
            const icon = resizeImage({
                image: await character.getIcon(),
                heightMax: iconWidth
            })
            const canvas = new Canvas(width, height)
            const ctx = canvas.getContext("2d")
            ctx.drawImage(icon, spacing, (height - iconWidth) / 2)
            ctx.drawCanvas(drawRoundedRectWithText({
                text: `${(bouns[i].potential.performance * 100).toFixed(1)}% ${(bouns[i].characterTask.performance * 100).toFixed(1)}%`,
                textSize: 25,
                color: "#E675A0",
                height: 40,
                width: width - iconWidth - 3 * spacing,
            }), iconWidth + 2 * spacing, spacing)
            ctx.drawCanvas(drawRoundedRectWithText({
                text: `${(bouns[i].potential.technique * 100).toFixed(1)}% ${(bouns[i].characterTask.technique * 100).toFixed(1)}%`,
                textSize: 25,
                color: "#6EB8E7",
                height: 40,
                width: width - iconWidth - 3 * spacing
            }), iconWidth + 2 * spacing, height / 3 + spacing)
            ctx.drawCanvas(drawRoundedRectWithText({
                text: `${(bouns[i].potential.visual * 100).toFixed(1)}% ${(bouns[i].characterTask.visual * 100).toFixed(1)}%`,
                textSize: 25,
                color: "#F6C964",
                height: 40,
                width: width - iconWidth - 3 * spacing
            }), iconWidth + 2 * spacing, height / 3 * 2 + spacing)
            list.push(canvas)
        }
        characterBounsList.push(canvas)
        for (let i = 0; i < list.length; i += rowMax) {
            const tmplist = list.slice(i, i + rowMax)
            characterBounsList.push(drawListMerge(tmplist, widthMax, false, "center"))
            characterBounsList.push(new Canvas(1, 5))
        }
        characterBounsList.pop()
    }
    all.push(drawDatablock({
        topLeftText: '角色加成',
        list: characterBounsList
    }))
    
    
    var BGimage = useEasyBG ? undefined : (await event.getEventBGImage())

    var buffer = await outputFinalBuffer({
        imageList: all,
        useEasyBG: useEasyBG,
        BGimage,
        text: 'Event',
        compress: compress,
    })

    perf('图片合成+压缩')

    return [buffer];
}
