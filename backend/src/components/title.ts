import { Canvas, Image } from 'skia-canvas'
import { drawText } from '@/image/text'
import { assetsRootPath } from '@/config'
import * as path from 'path'
import { loadImageFromPath } from '@/image/utils';
import { releaseCanvas } from '@/components/utils'


var titleImage: Image
//标题条白底区域: 顶部起始行(粉带底边)与仍完全实心的最右列, 用于长副标题时向右延伸白底
var titleWhiteTop = 0
var titleWhiteRight = 0

async function loadImageOnce() {
    titleImage = await loadImageFromPath(path.join(assetsRootPath, '/title.png'))
    //解析白底范围: 左端实心列自上而下找第一个白色像素为白底顶; 白底中部行自右向左找第一个实心白色像素为实心右界
    const probe = new Canvas(titleImage.width, titleImage.height)
    const probeCtx = probe.getContext('2d')
    probeCtx.drawImage(titleImage, 0, 0)
    const data = probeCtx.getImageData(0, 0, titleImage.width, titleImage.height).data
    const isSolidWhite = (x: number, y: number) => {
        const i = (y * titleImage.width + x) * 4
        return data[i + 3] > 200 && data[i] > 240 && data[i + 1] > 240 && data[i + 2] > 240
    }
    for (let y = 0; y < titleImage.height; y++) {
        if (isSolidWhite(10, y)) {
            titleWhiteTop = y
            break
        }
    }
    const midWhiteY = Math.floor((titleWhiteTop + titleImage.height) / 2)
    titleWhiteRight = 0
    for (let x = titleImage.width - 1; x >= 0; x--) {
        if (isSolidWhite(x, midWhiteY)) {
            titleWhiteRight = x
            break
        }
    }
    releaseCanvas(probe)
}
loadImageOnce()

export function drawTitle(title1: string, title2: string, title3?: string): Canvas {
    //副标题(基准技能信息等),画在标题图下方,行高42
    const subtitleLineHeight = 42
    var subtitle: Canvas = null
    if (title3 != undefined) {
        subtitle = drawText({ text: title3, maxWidth: titleImage.width - 74, lineHeight: subtitleLineHeight, textSize: 28, color: '#7d7d7d', font: 'old' })
    }
    var text1 = drawText({ text: title1, maxWidth: 900, lineHeight: 50, textSize: 30, color: '#ffffff', font: 'old' })
    //副标题单行绘制不换行: 给足宽度, 画布宽度由文本实际宽度决定
    var text2 = drawText({ text: title2, maxWidth: 1000000, lineHeight: 68, textSize: 40, color: '#5b5b5b', font: 'old' })
    //副标题长于默认标题条时: 向右拉长标题条, 白色底边延伸, 副标题单行完整显示
    const paddingRight = 74
    const requiredWidth = Math.ceil(74 + text2.width) + paddingRight
    const canvasWidth = Math.max(titleImage.width, requiredWidth)
    const canvas = new Canvas(canvasWidth, titleImage.height + (subtitle ? subtitle.height : 0))
    const ctx = canvas.getContext("2d")
    ctx.drawImage(titleImage, 0, 0)
    if (canvasWidth > titleImage.width && titleWhiteRight > 0) {
        //从白底仍实心的位置起向右填充同色白底(覆盖原图右下角渐隐收尾, 保证无缝)
        ctx.fillStyle = '#fffffd'
        ctx.fillRect(titleWhiteRight - 2, titleWhiteTop, canvasWidth - titleWhiteRight + 2, titleImage.height - titleWhiteTop)
    }
    ctx.drawImage(text1, 74, 0)
    ctx.drawImage(text2, 74, 42)
    if (subtitle) {
        ctx.drawImage(subtitle, 74, titleImage.height)
    }
    return canvas
}

