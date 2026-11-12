import { Canvas, loadImage } from 'skia-canvas'

import { Card } from '@/types/Card';
import { drawCardIcon } from '@/components/card';
import { drawDegree } from '@/components/degree';
import { Server } from '@/types/Server';
import { Degree } from '@/types/Degree';
import { drawText } from '@/image/text';
import { downloadFileCache } from '@/api/downloadFileCache';
import { Bestdoriurl } from "@/config"

interface User {
    uid: number,
    name: string,
    introduction: string,
    rank: number,
    sid: number,
    strained: number,
    degrees: number[]
    ranking: number,
    currentPt: number
}

export async function drawPlayerRankingInList(user: User, backgroudColor: string = 'white', server: Server): Promise<Canvas> {
    var canvas = new Canvas(800, 110);
    var ctx = canvas.getContext('2d');
    ctx.fillStyle = backgroudColor;
    ctx.fillRect(0, 0, 800, 110);

    function removeBraces(text: string): string {
        var newText = text.replace(/\[[^\]]*\]/g, "");
        return newText;
    }

    //排名
    var rankingImage;
    if (user.ranking == undefined) {
        return;
    }
    else if (user.ranking > 0 && user.ranking <= 3) {
        const rankIamgeBuffer = await downloadFileCache(`${Bestdoriurl}/res/image/${Server[server]}_${user.ranking}.png`)
        rankingImage = await loadImage(rankIamgeBuffer);
        ctx.drawImage(rankingImage, 12, 45, 45, 21);
    }
    else {
        rankingImage = drawText({
            text: '#' + user.ranking.toString(),
            textSize: 21,
            maxWidth: 100
        });
        ctx.drawImage(rankingImage, 12, 45);
    }

    //头像: 卡片数据不存在时(如玩家资料未公开/代表卡异常), 绘制灰色占位块避免渲染中断
    var headShotImage: Canvas
    const avatarCard = new Card(user.sid)
    if (avatarCard.isExist) {
        headShotImage = await drawCardIcon({
            card: avatarCard,
            trainingStatus: user.strained == 0 ? false : true,
            cardIdVisible: false,
            skillTypeVisible: false,
            cardTypeVisible: false
        });
    }
    else {
        headShotImage = new Canvas(90, 90)
        const headShotCtx = headShotImage.getContext('2d')
        headShotCtx.fillStyle = '#d0d0d0'
        headShotCtx.fillRect(0, 0, 90, 90)
    }
    ctx.drawImage(headShotImage, 85, 10, 90, 90);

    //玩家昵称
    var playerNameImage = drawText({
        text: removeBraces(user.name),
        textSize: 23,
        maxWidth: 450
    });
    ctx.drawImage(playerNameImage, 210, 10);

    //牌子: 牌子数据不存在时跳过
    for (let i = 0; i < user.degrees.length; i++) {
        const degree = new Degree(user.degrees[i])
        if (!degree.isExist) {
            continue
        }
        var degreeImage = await drawDegree(degree, server);
        ctx.drawImage(degreeImage, 210 + (degreeImage.width / 2 + 10) * i, 46, degreeImage.width / 2, degreeImage.height / 2);
    }

    //简介
    var playerIntroductionImage = drawText({
        text: removeBraces(user.introduction),
        textSize: 20,
        maxWidth: 450
    });
    ctx.drawImage(playerIntroductionImage, 210, 75);

    //等级
    var playerRankImage = drawText({
        text: '等级 ' + user.rank.toString(),
        textSize: 23,
        maxWidth: 150
    });
    ctx.drawImage(playerRankImage, 790 - playerRankImage.width, 10);

    //id
    var idImage = drawText({
        text: '#' + user.uid,
        textSize: 20,
        maxWidth: 150
    });
    ctx.drawImage(idImage, 790 - idImage.width, 45);

    //pt
    var ptImage = drawText({
        text: user.currentPt.toString() + '分',
        textSize: 23,
        maxWidth: 150
    });
    ctx.drawImage(ptImage, 790 - ptImage.width, 70);

    return canvas;
}