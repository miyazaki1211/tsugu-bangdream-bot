
export type LiveVariant = 'solo' | 'cooperative' | 'versus' | 'festival' | 'medley' | 'challenge_cp';

// ---------- 请求侧 ----------

export interface SongSelection {
    songId: number;
    difficulty: number;
}

/** 协力模式 - 队友参数 */
export interface CooperativeTeammate {
    expectedStat: number;
    leaderScoreUp: number;
    leaderSkillDuration: number;
}

/** 协力模式 - 队长选择策略 */
export type CooperativeLeaderSelection =
    | { mode: 'max_stat' }
    | { mode: 'random' }
    | { mode: 'specified'; playerIndex: number };

/** 协力模式配置 */
export interface CooperativeInput {
    teammates: CooperativeTeammate | [CooperativeTeammate, CooperativeTeammate, CooperativeTeammate, CooperativeTeammate];
    leaderSelection?: CooperativeLeaderSelection;
}

/** 对邦模式配置 */
export interface VersusInput {
    teamRank: number; // u8, 0-4, 0=第1名
}

/** 5v5 FES 模式配置 */
export interface FestivalInput {
    teammateScores: number | [number, number, number, number];
    teamRank: number; // u8, 0-4
    won: boolean;
}

/** PtMaximizeRequest 子对象 */
export interface PtMaximizeRequestPayload {
    eventType: string;
    liveVariant: LiveVariant;
    songs: SongSelection[];
    minimumPersonalStat?: number | null;
    missionSupportPtBonus?: number | null;
    cooperative?: CooperativeInput | null;
    versus?: VersusInput | null;
    festival?: FestivalInput | null;
}

/** 顶层请求体 (POST /v1/pt-maximize) */
export interface PtMaximizeApiRequest {
    playerId: number;
    server: string;           // "jp" | "en" | "tw" | "cn" | "kr"
    eventId?: number;
    request: PtMaximizeRequestPayload;
}

// ---------- 响应侧 ----------

export interface SelectedAreaItems {
    band: string;
    attribute: string;
    magazine: string;
}

export interface AveragePt {
    ptSum: string;        // u128 → JSON string, PT 总和分子
    sampleCount: number;  // u64, 采样次数分母
}

/** 分数分布直方图 */
export interface ScoreHistogram {
    entries: Array<[number, number]>; // 有序 (score, count)
    scoreSum: number;
    minScore: number;
    maxScore: number;
    sampleCount: number;
}

/** 单曲 PT 评估 */
export interface FixedTeamPtEvaluation {
    eventType: string;
    liveVariant: LiveVariant;
    captainIndex: number;
    captainCardId: number;
    scoreDistribution: ScoreHistogram;
    averagePt: AveragePt;
    minPt: number;
    maxPt: number;
    averageCpGain?: AveragePt | null;    // 仅 challenge_cp
    challengeCpCost?: number | null;     // 仅 challenge_cp
}

/** 场景摘要 */
export interface PtMaximizeScenarioSummary {
    includesFever?: boolean;
    minimumPersonalStat?: number | null;
    cooperative?: CooperativeInput | null;
    versus?: VersusInput | null;
    festival?: FestivalInput | null;
}

/** 计算性能指标 (单曲) */
export interface SingleMetrics {
    itemCount: number;
    modeCount: number;
    modeSearchCount: number;
    retainedCardCount: number;
    plannedTeamCount: number;
    exploredTeamCount: number;
    exactEvaluationCount: number;
    candidateBuildMs: number;
    solveMs: number;
    exactEvaluationMs: number;
    totalElapsedMs: number;
}

/** 计算性能指标 (组曲) */
export interface MedleyMetrics {
    itemCount: number;
    itemUpperBoundMs: number;
    rawCandidateCount: number;
    retainedCandidateCount: number;
    candidateBuildMs: number;
    seedMs: number;
    solveMs: number;
    pairCheckCount: number;
    thirdCheckCount: number;
    compatiblePlanCount: number;
    exactDistributionCount: number;
    totalElapsedMs: number;
}

/** 计算性能指标 */
export interface PtMaximizeMetrics {
    coreVersion?: string;
    cardCount?: number;
    songCount?: number;
    totalElapsedMs?: number;
    single?: SingleMetrics;
    medley?: MedleyMetrics;
}

/** 单曲模式: 最优队伍 */
export interface PtMaximizeSingleTeam {
    teamCardIds: number[];
    captainCardId: number;
    totalStat: number;
    pointBonusBasisPoints?: number;
    items?: SelectedAreaItems;
    evaluation: FixedTeamPtEvaluation;
}

/** 组曲模式: 每首歌的队伍 */
export interface PtMaximizeMedleyTeam {
    teamCardIds: number[];
    captainCardId: number;
    totalStat: number;
    items?: SelectedAreaItems;
    scoreDistribution?: ScoreHistogram;
}

/** 组曲模式: 汇总 */
export interface PtMaximizeMedley {
    teams: PtMaximizeMedleyTeam[];
    averagePt: AveragePt;
    minPt: number;
    maxPt: number;
    totalScoreSum: string;
    sampleCount: number;
}

/** 顶层响应 data */
export interface PtMaximizeResult {
    eventId: number;
    eventType: string;
    liveVariant: LiveVariant;
    songs: SongSelection[];
    scenario: PtMaximizeScenarioSummary;
    metrics: PtMaximizeMetrics;
    team?: PtMaximizeSingleTeam | null;
    medley?: PtMaximizeMedley | null;
}

/** API 响应信封 */
export interface ApiEnvelope<T> {
    status: 'ok' | 'error';
    data?: T;
    message?: string;
}

// ---------- score-range 响应侧 ----------

/** 单条演奏动作 */
export interface ScoreRangePlay {
    songId: number;
    difficulty: number;
    fireMultiplier: number;
    score: number;
    pt: number;
    count: number;
}

/** 控分方案 (POST /v1/score-range 响应 data 数组的元素) */
export interface ScoreRangeResult {
    eventType: string;
    targetDeltaPt: number;
    teamCardIds: number[];
    totalStat: number;
    pointBonusBasisPoints: number;
    items: SelectedAreaItems;
    playCount: number;
    distinctSongCount: number;
    totalFireCost: number;
    totalFireMultiplier: number;
    plays: ScoreRangePlay[];
}
