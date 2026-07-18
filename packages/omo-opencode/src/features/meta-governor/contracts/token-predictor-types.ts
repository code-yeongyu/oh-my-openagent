export interface TokenPrediction {
  readonly currentUsage: number
  readonly burnRate: number
  readonly budgetLeft: number
  readonly willOverflowAt: string | null
  readonly recommendation: TokenRecommendation
  readonly confidence: number
  readonly modelLimit: number
  readonly windowRemaining: number
}

export type TokenRecommendation =
  | "compact-now"
  | "switch-model"
  | "delegate-to-subagent"
  | "no-action"

export interface TokenPredictorConfig {
  readonly compactBurnRateThreshold: number
  readonly compactUsageThreshold: number
  readonly switchModelUsageThreshold: number
  readonly delegateConsecutiveHighBurn: number
  readonly windowSize: number
}

export interface TokenPredictorInput {
  readonly currentUsage: number
  readonly modelLimit: number
  readonly recentTurnTokens: readonly number[]
  readonly timestampISO: string
  readonly providerID: string
  readonly modelID: string
  readonly config: TokenPredictorConfig
}

export interface TokenPredictorOutput extends TokenPrediction {
  readonly input: TokenPredictorInput
  readonly computedAtISO: string
  readonly turnsAnalyzed: number
}
