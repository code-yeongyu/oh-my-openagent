/**
 * MetaGovernor Decision Handler Hook — PR 6 of 8.
 *
 * Thin adapter that delegates scoring results to the decision handler.
 * Follows edit-error-recovery hook pattern: factory + exported functions.
 */

import type {
  DecisionHandlerConfig,
  DecisionHandlerInput,
  DecisionHandlerOutput,
} from "../../features/meta-governor/types"
import {
  defaultDecisionHandlerConfig,
  handleDecision,
} from "../../features/meta-governor/decision-handler"

export interface DecisionHookState {
  config: DecisionHandlerConfig
}

/**
 * Create a fresh decision hook state.
 */
export function createDecisionHookState(
  config?: Partial<DecisionHandlerConfig>
): DecisionHookState {
  return {
    config: { ...defaultDecisionHandlerConfig(), ...config },
  }
}

/**
 * Process a scoring result through the decision handler.
 */
export function processScoringResult(
  state: DecisionHookState,
  input: DecisionHandlerInput,
): DecisionHandlerOutput {
  return handleDecision(input, state.config)
}

/**
 * Get the default config for testing.
 */
export function getDecisionHookConfig(): DecisionHandlerConfig {
  return defaultDecisionHandlerConfig()
}
