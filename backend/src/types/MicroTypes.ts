
export interface MicroCard {
  cardId: number
  skillId: number
  [key: string]: unknown
}

export interface MicroTeam {
  cards: MicroCard[]
  bandPower: number
  /** 统一加成 (五卡同团/同属性); 混活或跨团队伍下可能为 null/缺失 */
  unification?: {
    bandId: number
    attribute: string
  } | null
}

export interface MicroOptimization {
  /** micro 事件表索引 (展开后按时间排序, 同时刻普通 note 在前) */
  index: number
  kind: string
  /** note 原始时间 (秒) */
  time: number
  /** 偏移帧数 (1帧 = 1/60 秒) */
  offset: number
  /** 微操后的最终判定 (升格后), 如 perfect / great */
  judgement: string
}

export interface MicroSkillWindow {
  slot: number
  cardIndex: number
  cardId: number
  triggerIndex: number
  triggerTime: number
  start: number
  end: number
  queued: boolean
  coveredNotes: number
}

export interface MicroSongInfo {
  songId: number
  difficulty: number
  playLevel: number
  noteCount: number
}

export interface MicroOptimizeData {
  eventId: number
  eventType: string
  song: MicroSongInfo
  team: MicroTeam
  baselineScore: number
  maxScore: number
  scoreGain: number
  /** 6 个发动槽的卡牌 ID */
  skillOrder: number[]
  /** 仅含非 0 偏移项 */
  optimizations: MicroOptimization[]
  skillWindows: MicroSkillWindow[]
  meta: {
    simulations: number
    totalOffset: number
    semantics: string
  }
}

export interface MicroApiEnvelope {
  status: 'ok' | 'error'
  data?: MicroOptimizeData
  message?: string
}
