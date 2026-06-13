import type { AgentmemoryWriteBackend, ClosedLoopConfig, LearnFromOutcomeOutput } from "./closed-loop-types"
import type { DecisionHandlerConfig, DecisionHandlerOutput, DecisionHistoryEntry } from "./decision-handler-types"
import type { Deviation } from "./decision-types"
import type { MemoryBackends, MemoryRead } from "./memory-types"
import type { ScoringConfig, ScoringResult } from "./scoring-types"
import type { TokenPredictorConfig, TokenPredictorOutput } from "./token-predictor-types"

export interface OrchestratorConfig {
  readonly enabled: boolean
  readonly memory: {
    readonly enabled: boolean
    readonly query: string
    readonly timeoutMs?: number
  }
  readonly tokenPredictor: Partial<TokenPredictorConfig>
  readonly scoring: Partial<ScoringConfig>
  readonly decision: Partial<DecisionHandlerConfig>
  readonly closedLoop: Partial<ClosedLoopConfig>
}

export interface MetaGovernorInput {
  readonly sessionID: string
  readonly toolName: string
  readonly toolInput?: unknown
  readonly toolOutput?: unknown
  readonly agentName?: string
  readonly providerID?: string
  readonly modelID?: string
  readonly iteration: number
  readonly maxIterations: number
  readonly oracleVerified: boolean
  readonly noProgress: boolean
  readonly filesChanged: number
  readonly recentTurnTokens: readonly number[]
  readonly deviations: readonly Deviation[]
  readonly consecutiveStops?: number
  readonly backends: MemoryBackends
  readonly writeBackend: AgentmemoryWriteBackend
  readonly config?: Partial<OrchestratorConfig>
}

export interface MetaGovernorOutput {
  readonly memoryRead: MemoryRead
  readonly tokenPrediction: TokenPredictorOutput
  readonly scoringResult: ScoringResult
  readonly decision: DecisionHandlerOutput
  readonly lessonSaved: LearnFromOutcomeOutput | null
  readonly decisionHistory: readonly DecisionHistoryEntry[]
  readonly skipped: boolean
  readonly skipReason?: string
}
