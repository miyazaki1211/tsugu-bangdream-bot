import { Song, difficultyName } from '@/types/Song'
import { Band } from '@/types/Band'
import { getServerByPriority } from '@/types/Server'
import { globalDefaultServer } from '@/config';
import * as BestdoriPreview from '@/components/BestdoriPreview.cjs'
import { drawList, drawListMerge, drawListTextWithImages, drawBandItemContent, drawAttributeItemContent } from '@/components/list';
import { drawDatablock } from '@/components/dataBlock';
import { drawTitle } from '@/components/title';
import { drawCardIcon } from '@/components/card';
import { Card } from '@/types/Card';
import { Skill } from '@/types/Skill';
import { Character } from '@/types/Character';
import { playerDetail } from '@/types/BuildTypes';
import { MicroOptimizeData, MicroOptimization, MicroSkillWindow } from '@/types/MicroTypes';
import { outputFinalBuffer } from '@/image/output';
import { resizeImage, stackImage, stackImageHorizontal } from '@/components/utils';
import { drawDifficulity } from '@/components/list/difficulty';
import { statConfig } from '@/components/list/stat';
import { drawRoundedRectWithText } from '@/image/drawRect';
import { drawText } from '@/image/text';
import { Canvas } from 'skia-canvas';

// ============================================================
//  micro 事件展开 (语义: bangdream-optimize/docs/micro-optimize-design-draft.md §3.1)
//  与 BestdoriPreview 的展开不同: 不含 Sim/Bar/BPM, 保留 10 种判定类型
// ============================================================

interface ExpandedMicroEvent {
  kind: string
  time: number
  lane: number
  skill: boolean
}

export function expandMicroEvents(chart: any[]): ExpandedMicroEvent[] {
  const events: ExpandedMicroEvent[] = []
  for (const n of chart) {
    if (n.type === 'Single') {
      events.push({ kind: n.flick ? 'flick' : 'tap', time: n.time, lane: n.lane, skill: !!n.skill })
    } else if (n.type === 'Directional') {
      // 方向滑键永不带技能位
      events.push({ kind: 'directionalFlick', time: n.time, lane: n.lane, skill: false })
    } else if (n.type === 'Long') {
      const cs = n.connections
      events.push({ kind: 'longStart', time: cs[0].time, lane: cs[0].lane, skill: !!cs[0].skill })
      const tail = cs[cs.length - 1]
      events.push({ kind: tail.flick ? 'longFlick' : 'longEnd', time: tail.time, lane: tail.lane, skill: !!tail.skill })
    } else if (n.type === 'Slide') {
      // 全部可见 connection, 头/中/尾按含 hidden 的原始下标判定
      const cs = n.connections
      cs.forEach((c: any, i: number) => {
        if (c.hidden) return
        let kind: string
        if (i === 0) kind = 'slideStart'
        else if (i === cs.length - 1) kind = c.flick ? 'slideFlick' : 'slideEnd'
        else kind = 'slideTick'
        events.push({ kind, time: c.time, lane: c.lane, skill: !!c.skill })
      })
    }
  }
  // 同时刻普通 note 排在技能 note 前 (与 micro sort_events 一致)
  events.sort((a, b) => a.time - b.time || Number(a.skill) - Number(b.skill))
  return events
}

// index 对不上时按时间+类型兜底
function findEvent(events: ExpandedMicroEvent[], opt: MicroOptimization): ExpandedMicroEvent | null {
  const byIndex = events[opt.index]
  if (byIndex && Math.abs(byIndex.time - opt.time) <= 0.05 && byIndex.kind === opt.kind) {
    return byIndex
  }
  let best: ExpandedMicroEvent | null = null
  let bestDt = Infinity
  for (const e of events) {
    if (e.kind !== opt.kind) continue
    const dt = Math.abs(e.time - opt.time)
    if (dt < bestDt) {
      bestDt = dt
      best = e
    }
  }
  if (best && bestDt <= 0.05) return best
  return byIndex ?? best
}

// ============================================================
//  谱面叠加层绘制
// ============================================================

// 6 个技能槽的颜色
const SLOT_COLORS = ['#FF5A5A', '#3EC6E0', '#F5C542', '#8C6BF0', '#33C481', '#F08A4B']

// 技能简写: 分值 + 卡类型标识 (判卡 J / 盾卡 S / 生命卡 L / 特殊分卡 G、P / 纯分卡无字母)
function skillShortText(skillId: number): string {
  const skill = new Skill(skillId)
  const types = skill.getEffectTypes()
  let text = `${skill.getScoreUpMaxValue()}`
  if (types.includes('judge')) {
    text += 'J'
  } else if (types.includes('damage')) {
    text += 'S'
  } else if (types.includes('life') || types.includes('never_die') || types.includes('score_over_life') || types.includes('score_under_life')) {
    text += 'L'
  } else if (types.includes('score_continued_note_judge')) {
    text += 'G'
  } else if (types.includes('score_under_great_half') || types.includes('score_perfect')) {
    text += 'P'
  } else if (types.includes('score_rate_up_with_perfect')) {
    text += '+0.5*P'
  }
  return text
}

// 微操后的原始判定 = 偏移量按判定窗口表推算 (design-draft §3.2); 与响应 judgement 不一致即被技能升格
const SYMMETRIC_JUDGE_WINDOWS: { [kind: string]: [number, number, number, number] } = {
  // [perfect, great, good, bad] (帧, 对称)
  tap: [3.5, 6.5, 7.5, 8.5],
  flick: [3.5, 6.5, 7.5, 8.5],
  directionalFlick: [3.5, 6.5, 7.5, 8.5],
  longStart: [3.5, 6.5, 7.5, 8.5],
  longEnd: [4.5, 7.5, 8.5, 9.5],
  longFlick: [4.5, 7.5, 8.5, 9.5],
}

const JUDGE_ABBR: { [j: string]: string } = { perfect: 'p', great: 'g', good: 'gd', bad: 'b', miss: 'm' }

function rawJudgementOf(kind: string, offset: number): string {
  if (kind === 'slideStart' || kind === 'slideEnd') {
    // 滑条两端: 各档共享上界 +12.5, 下界递减
    if (offset >= -3.5 && offset <= 12.5) return 'perfect'
    if (offset >= -6.5) return 'great'
    if (offset >= -7.5) return 'good'
    if (offset >= -8.5) return 'bad'
    return 'miss'
  }
  if (kind === 'slideTick') return (offset >= 0 && offset <= 12.5) ? 'perfect' : 'miss'
  if (kind === 'slideFlick') return (offset >= 0 && offset <= 6.5) ? 'perfect' : 'miss'
  const windows = SYMMETRIC_JUDGE_WINDOWS[kind] ?? [3.5, 6.5, 7.5, 8.5]
  const abs = Math.abs(offset)
  if (abs <= windows[0]) return 'perfect'
  if (abs <= windows[1]) return 'great'
  if (abs <= windows[2]) return 'good'
  if (abs <= windows[3]) return 'bad'
  return 'miss'
}

function colOf(layout: any, time: number): number {
  return Math.floor(time / layout.secondsPerCol)
}

// 栏内局部坐标换算, 避免全局取模在分栏边界处的浮点跳变 (t=栏起点 → height 底部, t=栏终点 → 0 顶部)
function yInCol(layout: any, time: number, col: number): number {
  return layout.height - (time - col * layout.secondsPerCol) * layout.heightPerSecond
}

function laneX(layout: any, col: number): number {
  return layout.infoAreaWidth + col * layout.originalWidth + layout.blockDistance
}

// 技能窗口: 半透明色带横跨 7 轨道 (画在音符之下)
function drawSkillWindows(ctx: any, layout: any, windows: MicroSkillWindow[], data: MicroOptimizeData) {
  for (const w of windows) {
    if (!(w.end > w.start)) continue
    const color = SLOT_COLORS[w.slot % SLOT_COLORS.length]
    const startCol = colOf(layout, w.start)
    const endCol = colOf(layout, w.end)
    for (let col = startCol; col <= endCol; col++) {
      const t0 = Math.max(w.start, col * layout.secondsPerCol)
      const t1 = Math.min(w.end, (col + 1) * layout.secondsPerCol)
      if (t1 <= t0) continue
      const x = laneX(layout, col)
      const w7 = 7 * layout.laneWidth
      const yBottom = Math.min(layout.height, yInCol(layout, t0, col))
      const yTop = Math.max(0, yInCol(layout, t1, col))
      if (yBottom - yTop <= 0) continue
      // 半透明色带 (加深, 33% alpha)
      ctx.fillStyle = color + '55'
      ctx.fillRect(x, yTop, w7, yBottom - yTop)
      // 起点边线 (仅首列画)
      if (col === startCol) {
        ctx.fillStyle = color
        ctx.fillRect(x, yBottom - 3, w7, 3)
      }
      // 标签: #槽位 技能简写 (排队) 覆盖数
      ctx.save()
      ctx.font = '16px "Microsoft Yahei UI", "Arial"'
      ctx.textAlign = 'left'
      ctx.textBaseline = 'top'
      const card = data.team.cards.find(c => c.cardId === w.cardId)
      const skillText = card ? skillShortText(card.skillId) : `${w.cardId}`
      const text = `#${w.slot + 1} ${skillText}${w.queued ? ' (排队)' : ` 覆盖${w.coveredNotes}`}`
      const tw = ctx.measureText(text).width
      ctx.fillStyle = 'rgba(0,0,0,0.55)'
      ctx.fillRect(x + 2, yTop + 2, tw + 8, 22)
      ctx.fillStyle = color
      ctx.fillText(text, x + 6, yTop + 4)
      ctx.restore()
    }
  }
}

// 微操标记与技能槽位标记 (画在音符之上)
function drawMarkers(
  ctx: any,
  layout: any,
  events: ExpandedMicroEvent[],
  optimizations: MicroOptimization[],
  windows: MicroSkillWindow[]
) {
  // 技能 note 上的槽位编号圆环
  for (const w of windows) {
    const ev = events[w.triggerIndex]
    if (!ev) continue
    const col = colOf(layout, ev.time)
    const x = laneX(layout, col) + (ev.lane + 0.5) * layout.laneWidth
    const y = yInCol(layout, ev.time, col)
    const color = SLOT_COLORS[w.slot % SLOT_COLORS.length]
    ctx.save()
    ctx.strokeStyle = color
    ctx.lineWidth = 3
    ctx.beginPath()
    ctx.arc(x, y, 19, 0, Math.PI * 2)
    ctx.stroke()
    ctx.font = 'bold 16px "Arial"'
    ctx.textAlign = 'center'
    ctx.textBaseline = 'bottom'
    ctx.fillStyle = color
    ctx.fillText(`${w.slot + 1}`, x, y - 21)
    ctx.restore()
  }
  // 微操 note 标记: 圆环 + 帧偏移标签; 金色 = 技能按键, 绿色 = 普通 note
  for (const opt of optimizations) {
    const ev = findEvent(events, opt)
    if (!ev) continue
    const col = colOf(layout, ev.time)
    const x = laneX(layout, col) + (ev.lane + 0.5) * layout.laneWidth
    const y = yInCol(layout, ev.time, col)
    const isSkillNote = ev.skill
    const color = isSkillNote ? '#FFD700' : '#7CFC00'
    ctx.save()
    ctx.strokeStyle = color
    ctx.lineWidth = 3
    ctx.beginPath()
    ctx.arc(x, y, 17, 0, Math.PI * 2)
    ctx.stroke()
    const rawChar = JUDGE_ABBR[rawJudgementOf(ev.kind, opt.offset)] ?? '?'
    const finalChar = JUDGE_ABBR[opt.judgement] ?? opt.judgement
    const judgeText = rawChar === finalChar ? `(${finalChar})` : `(${rawChar}->${finalChar})`
    const offsetText = `${opt.offset > 0 ? '+' : ''}${opt.offset}f${judgeText}`
    ctx.font = 'bold 18px "Arial"'
    ctx.textAlign = 'left'
    ctx.textBaseline = 'middle'
    ctx.lineWidth = 3
    ctx.strokeStyle = 'rgba(0,0,0,0.8)'
    ctx.strokeText(offsetText, x + 21, y)
    ctx.fillStyle = color
    ctx.fillText(offsetText, x + 21, y)
    ctx.restore()
  }
}

// ============================================================
//  概要块
// ============================================================

const EVENT_TYPE_NAME: { [type: string]: string } = {
  challenge: '挑战',
  versus: '对邦',
}

function skillOrderText(data: MicroOptimizeData): string {
  const positions = data.team.cards.map(c => c.cardId)
  return data.skillOrder.map(cardId => {
    const idx = positions.indexOf(cardId)
    return idx == -1 ? `${cardId}` : `${idx + 1}`
  }).join('>')
}

// 玩家档案中的卡牌配置 (同 calcResult 的 toCardInfo 逻辑)
function playerCardConfig(player: playerDetail, cardId: number) {
  const cardConfig = player?.cardList?.[cardId]
  if (cardConfig) {
    return {
      illustTrainingStatus: cardConfig.illustTrainingStatus ?? true,
      limitBreakRank: cardConfig.limitBreakRank,
      skillLevel: cardConfig.skillLevel,
    }
  }
  return { skillLevel: 1 }
}

// 把窄图居中到指定宽度 (概要块对齐谱面图)
function centerToWidth(img: Canvas, width: number): Canvas {
  if (img.width >= width) return img
  const canvas = new Canvas(width, img.height)
  canvas.getContext('2d').drawImage(img, Math.floor((width - img.width) / 2), 0)
  return canvas
}

// 紧凑歌曲条: 封面 → 难度徽章 → 歌名/乐队名
async function drawSongCompact(song: Song, difficulty: number, server: number, bandName: string, maxWidth: number): Promise<Canvas> {
  const jacket = resizeImage({ image: await song.getSongJacketImage(), widthMax: 110, heightMax: 110 })
  const diffImage = drawDifficulity(difficulty, song.difficulty[difficulty].playLevel, 70)
  const textX = 110 + 16 + diffImage.width + 16
  const textMaxWidth = Math.max(160, maxWidth - textX - 8)
  const titleImage = drawText({ text: song.musicTitle[server], textSize: 34, maxWidth: textMaxWidth, lineHeight: 44 })
  const bandImage = drawText({ text: bandName, textSize: 24, color: '#a7a7a7', maxWidth: textMaxWidth, lineHeight: 32 })
  const textHeight = titleImage.height + bandImage.height
  const height = Math.max(110, diffImage.height, textHeight)
  const canvas = new Canvas(maxWidth, height)
  const ctx = canvas.getContext('2d')
  ctx.drawImage(jacket, 0, (height - jacket.height) / 2)
  ctx.drawImage(diffImage, 110 + 16, (height - diffImage.height) / 2)
  ctx.drawImage(titleImage, textX, (height - textHeight) / 2)
  ctx.drawImage(bandImage, textX, (height - textHeight) / 2 + titleImage.height)
  return canvas
}

// 把窄图右对齐到指定宽度
function rightAlignToWidth(img: Canvas, width: number): Canvas {
  if (img.width >= width) return img
  const canvas = new Canvas(width, img.height)
  canvas.getContext('2d').drawImage(img, width - img.width, 0)
  return canvas
}

// 裁掉 canvas 右侧的透明留白 (drawListTextWithImages 等输出宽 = maxWidth, 内容左对齐)
function trimHorizontal(img: Canvas): Canvas {
  const ctx = img.getContext('2d')
  const { width, height } = img
  const data = ctx.getImageData(0, 0, width, height).data
  let right = -1
  for (let x = width - 1; x >= 0; x--) {
    for (let y = 0; y < height; y++) {
      if (data[(y * width + x) * 4 + 3] > 10) {
        right = x
        break
      }
    }
    if (right >= 0) break
  }
  const trimmed = new Canvas(Math.min(width, right + 12), height)
  trimmed.getContext('2d').drawImage(img, 0, 0)
  return trimmed
}

// 紧凑潜力块: 当前队伍五人的潜力/角色任务 (同组队计计算的配色, 压缩宽度后排在第二行右侧)
async function drawPotentialCompact(player: playerDetail, cardIds: number[], maxWidth: number): Promise<Canvas> {
  const rowMax = 5, iconWidth = 28, rowHeight = 24, spacing = 3
  const cellWidth = maxWidth / rowMax
  const height = rowHeight * 3 + spacing * 4
  const fmt = (v?: number) => `${((v ?? 0) * 100).toFixed(1)}%`
  const canvas = new Canvas(maxWidth, height)
  const ctx = canvas.getContext('2d')
  for (let i = 0; i < cardIds.length && i < rowMax; i++) {
    const characterId = new Card(cardIds[i]).characterId
    const bouns = player.characterBouns?.[characterId]
    const cellX = i * cellWidth
    const icon = resizeImage({ image: await new Character(characterId).getIcon(), heightMax: iconWidth })
    ctx.drawImage(icon, cellX + spacing, (height - iconWidth) / 2)
    const textWidth = cellWidth - iconWidth - 3 * spacing
    const drawLine = (text: string, color: string, lineIndex: number) => {
      ctx.drawCanvas(drawRoundedRectWithText({
        text, textSize: 15, color, height: rowHeight, width: textWidth,
      }), cellX + iconWidth + 2 * spacing, spacing + lineIndex * (rowHeight + spacing))
    }
    drawLine(`${fmt(bouns?.potential?.performance)} ${fmt(bouns?.characterTask?.performance)}`, '#E675A0', 0)
    drawLine(`${fmt(bouns?.potential?.technique)} ${fmt(bouns?.characterTask?.technique)}`, '#6EB8E7', 1)
    drawLine(`${fmt(bouns?.potential?.visual)} ${fmt(bouns?.characterTask?.visual)}`, '#F6C964', 2)
  }
  return canvas
}

export async function drawMicroOptimize(data: MicroOptimizeData, player: playerDetail, items: { band: string, attribute: string, magazine: 'performance' | 'technique' | 'visual' } | undefined, compress: boolean): Promise<Array<Buffer | string>> {
  const songInfo = data.song
  const song = new Song(songInfo.songId)
  if (!song.isExist) {
    return ['歌曲不存在']
  }
  await song.initFull()
  if (!song.difficulty[songInfo.difficulty]) {
    return ['难度不存在']
  }
  const server = getServerByPriority(song.publishedAt, globalDefaultServer)
  const bandName = new Band(song.bandId).bandName[server]

  // 谱面 + micro 事件表 (同一份换算后的时间)
  const chart = await song.getSongChart(songInfo.difficulty)
  BestdoriPreview.ResolveChartTimes(chart)
  const events = expandMicroEvents(chart)

  const chartCanv = await BestdoriPreview.DrawPreview({
    id: song.songId,
    title: song.musicTitle[server],
    artist: bandName,
    author: song.detail.lyricist[server],
    level: song.difficulty[songInfo.difficulty].playLevel,
    diff: difficultyName[songInfo.difficulty],
    cover: song.getSongJacketImageURL(globalDefaultServer),
    renderScale: 2,
    infoArea: false,
    blockDistance: 24,
    timeStep: 2,
    noteCountStep: 25
  }, chart, {
    under: (ctx: any, layout: any) => drawSkillWindows(ctx, layout, data.skillWindows, data),
    over: (ctx: any, layout: any) => drawMarkers(ctx, layout, events, data.optimizations, data.skillWindows)
  })

  // 概要块: 统计行 + 队伍行, 合并为单个数据块压缩高度 (drawDatablock 左右各加 100 padding)
  const width = chartCanv.width - 200
  // 9 个槽位按权重分配: 歌曲 活动 基线分 最高分 提升 综合力 微操项数 总偏移 技能发动次序
  // (提升槽需要容纳 6 位分差数字, 权重不宜低于 0.09; 歌曲槽内容自适应缩放可适当压缩)
  const slotWeights = [0.24, 0.09, 0.10, 0.10, 0.09, 0.10, 0.08, 0.07, 0.13]
  const widthList = slotWeights.map(w => Math.floor(width * w))
  const slotMaxWidth = (i: number) => widthList[i] - 20
  const textSize = 28

  const songImage = await drawSongCompact(song, songInfo.difficulty, server, bandName, slotMaxWidth(0))

  const eventImage = drawList({ key: '活动', text: `${data.eventId} ${EVENT_TYPE_NAME[data.eventType] ?? data.eventType}`, maxWidth: slotMaxWidth(1), textSize })
  const baselineImage = drawList({ key: '基线分', text: `${data.baselineScore}`, maxWidth: slotMaxWidth(2), textSize })
  const maxScoreImage = drawList({ key: '最高分', text: `${data.maxScore}`, maxWidth: slotMaxWidth(3), textSize })
  const gainImage = drawList({ key: '提升', text: `+${data.scoreGain}`, maxWidth: slotMaxWidth(4), textSize })
  const bandPowerImage = drawList({ key: '综合力', text: `${data.team.bandPower}`, maxWidth: slotMaxWidth(5), textSize })
  const optCountImage = drawList({ key: '微操项数', text: `${data.optimizations.length}`, maxWidth: slotMaxWidth(6), textSize })
  const totalOffsetImage = drawList({ key: '总偏移(帧)', text: `${data.meta.totalOffset}`, maxWidth: slotMaxWidth(7), textSize })
  const orderImage = drawList({ key: '技能发动次序', text: skillOrderText(data), maxWidth: slotMaxWidth(8), textSize })

  const teamContent = await Promise.all(data.team.cards.map(c => drawCardIcon({
    card: new Card(c.cardId),
    trainingStatus: true,
    cardIdVisible: true,
    skillTypeVisible: true,
    cardTypeVisible: false,
    ...playerCardConfig(player, c.cardId)
  })))

  // 第二行: 乐队(最左, 混活/跨团无统一加成时省略) + 五卡 + 三类道具 (道具同开始计算的样式)
  let bandCell: Canvas | null = null
  if (data.team.unification?.bandId != null) {
    const uniBand = new Band(data.team.unification.bandId)
    const bandIconImg = resizeImage({ image: await uniBand.getIcon(), heightMax: 90 })
    const bandNameImg = drawText({ text: uniBand.bandName[server], textSize: 28, maxWidth: 320, lineHeight: 36 })
    bandCell = new Canvas(bandIconImg.width + 10 + bandNameImg.width + 16, Math.max(bandIconImg.height, bandNameImg.height))
    const bcctx = bandCell.getContext('2d')
    bcctx.drawImage(bandIconImg, 0, Math.floor((bandCell.height - bandIconImg.height) / 2))
    bcctx.drawCanvas(bandNameImg, bandIconImg.width + 10, Math.floor((bandCell.height - bandNameImg.height) / 2))
  }

  const itemSelection = items ?? { band: '1000', attribute: '~all', magazine: 'performance' as const }
  const bandItemImage = drawListTextWithImages({ key: '乐队道具', content: await drawBandItemContent(itemSelection.band) })
  const attributeItemImage = drawListTextWithImages({ key: '颜色道具', content: await drawAttributeItemContent(itemSelection.attribute), lineSpacing: 40 })
  const magazineItemImage = drawList({ key: '杂志道具', text: `${statConfig[itemSelection.magazine].name}`, lineSpacing: 40 })

  const teamSpacing = 14
  const teamRow = trimHorizontal(drawListTextWithImages({
    key: '队伍',
    content: bandCell ? [bandCell, ...teamContent] : teamContent,
    maxWidth: 3400,
    spacing: teamSpacing
  }))
  // 右侧依次横排: 乐队道具 | 颜色道具 | 杂志道具 | 角色潜力 —— 道具间 50px 间距, 潜力占剩余宽度
  const gap = 30
  const rightWidth = width - teamRow.width - gap
  const itemsGap = 150
  const trimmedItems = [bandItemImage, attributeItemImage, magazineItemImage].map(img => trimHorizontal(img))
  const itemsRowW = trimmedItems.reduce((s, img) => s + img.width, 0) + itemsGap * (trimmedItems.length - 1)
  const itemsRow = new Canvas(itemsRowW, Math.max(...trimmedItems.map(i => i.height)))
  const ictx = itemsRow.getContext('2d')
  {
    let ix = 0
    for (const img of trimmedItems) {
      ictx.drawCanvas(img, ix, Math.floor((itemsRow.height - img.height) / 2))
      ix += img.width + itemsGap
    }
  }
  const itemsScale = Math.min(1, rightWidth * 0.9 / itemsRow.width)
  const itemsRowScaled = resizeImage({ image: itemsRow, widthMax: Math.floor(itemsRow.width * itemsScale) })
  const potentialCompact = await drawPotentialCompact(player, data.team.cards.map(c => c.cardId), rightWidth - itemsRowScaled.width - 20)

  const row2Height = Math.max(teamRow.height, itemsRowScaled.height, potentialCompact.height)
  const row2 = new Canvas(width, row2Height)
  const r2ctx = row2.getContext('2d')
  r2ctx.drawCanvas(teamRow, 0, Math.floor((row2Height - teamRow.height) / 2))
  r2ctx.drawCanvas(itemsRowScaled, teamRow.width + gap, Math.floor((row2Height - itemsRowScaled.height) / 2))
  r2ctx.drawCanvas(potentialCompact, width - potentialCompact.width, Math.floor((row2Height - potentialCompact.height) / 2))

  // 备注放在数据块右下角
    const noteImage = drawText({ text: '+1f代表延后1帧按, -1f代表提前1帧按', textSize: 26, color: '#7d7d7d', maxWidth: 900 })

  const all: Array<Canvas> = []
  all.push(centerToWidth(drawTitle('微操', '计算'), chartCanv.width))
  all.push(drawDatablock({
    list: [
      drawListMerge(
        [songImage, eventImage, baselineImage, maxScoreImage, gainImage, bandPowerImage, optCountImage, totalOffsetImage, orderImage],
        width, false, 'center', widthList
      ),
      centerToWidth(row2, width),
      rightAlignToWidth(noteImage, width)
    ]
  }))
  all.push(chartCanv)

  const buffer = await outputFinalBuffer({
    imageList: all,
    useEasyBG: true,
    text: 'Event',
    compress: compress
  })

  return [buffer]
}
