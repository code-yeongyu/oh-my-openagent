/**
 * MetaGovernor Token Predictor hook.
 *
 * Runs after tool execution to track token usage and predict context window
 * exhaustion. Writes prediction to session state for the orchestrator (PR 6).
 *
 * Pattern: follows edit-error-recovery hook structure.
 */

import type { TokenPrediction } from "../../features/meta-governor/types"
import type {
  TokenPredictorConfig,
  TokenPredictorInput,
} from "../../features/meta-governor/types"
import {
  calculateBurnRate,
  defaultTokenPredictorConfig,
  predict,
} from "../../features/meta-governor/token-predictor"

export interface TokenPredictorHookState {
  recentTurnTokens: number[]
  lastPrediction: TokenPrediction | null
  config: TokenPredictorConfig
}

/**
 * Create a fresh token predictor hook state.
 */
export function createTokenPredictorState(
  config?: Partial<TokenPredictorConfig>
): TokenPredictorHookState {
  return {
    recentTurnTokens: [],
    lastPrediction: null,
    config: { ...defaultTokenPredictorConfig(), ...config },
  }
}

/**
 * Record token usage for a completed turn.
 */
export function recordTurnTokens(
  state: TokenPredictorHookState,
  tokenCount: number
): void {
  state.recentTurnTokens.push(tokenCount)
  // Keep at most windowSize + 5 extra for history
  const maxKeep = state.config.windowSize + 5
  if (state.recentTurnTokens.length > maxKeep) {
    state.recentTurnTokens = state.recentTurnTokens.slice(-maxKeep)
  }
}

/**
 * Run prediction using accumulated turn data.
 */
export function runPrediction(
  state: TokenPredictorHookState,
  input: Omit<TokenPredictorInput, "recentTurnTokens" | "config">
): TokenPrediction {
  const fullInput: TokenPredictorInput = {
    ...input,
    recentTurnTokens: state.recentTurnTokens,
    config: state.config,
  }
  const result = predict(fullInput)
  state.lastPrediction = result
  return result
}
