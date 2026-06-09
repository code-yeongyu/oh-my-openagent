/**
 * MetaGovernor config loader — PR 8 of 8.
 *
 * Bridges the Zod schema (`MetaGovernorConfig`) with the runtime
 * configuration objects used by each module. The schema is the source
 * of truth for defaults — this loader just projects each sub-config
 * into the type the module expects.
 *
 * Important: undefined input is run through the schema's parse() so
 * that nested defaults are applied. This is what `MetaGovernorConfigSchema.parse({})`
 * does at the top of the function.
 */

import { MetaGovernorConfigSchema, type MetaGovernorConfig } from "../../config/schema/meta-governor"
import type { OrchestratorConfig } from "./types"
import { defaultScoringConfig } from "./scoring-engine"
import { defaultDecisionHandlerConfig } from "./decision-handler"
import { defaultClosedLoopConfig } from "./closed-loop-learning"

/**
 * Project the full MetaGovernorConfig into the OrchestratorConfig shape.
 * Missing sub-configs fall back to module defaults.
 */
export function loadOrchestratorConfig(
  config: Partial<MetaGovernorConfig> | undefined,
): OrchestratorConfig {
  // Run through Zod to apply nested defaults. This is what
  // makes `loadOrchestratorConfig(undefined)` produce a fully-populated
  // OrchestratorConfig with all defaults applied.
  const full = MetaGovernorConfigSchema.parse(config ?? {})

  const baseScoring = defaultScoringConfig()
  const baseDecision = defaultDecisionHandlerConfig()
  const baseClosedLoop = defaultClosedLoopConfig()

  return {
    enabled: full.enabled === true,
    memory: {
      enabled: true,
      query: full.memory?.query ?? "meta_governor_context",
      timeoutMs: full.memory?.agentmemoryTimeoutMs ?? 2000,
    },
    tokenPredictor: {
      compactBurnRateThreshold:
        full.tokenPredictor?.compactBurnRateThreshold ?? 500,
      compactUsageThreshold:
        full.tokenPredictor?.compactUsageThreshold ?? 0.85,
      switchModelUsageThreshold:
        full.tokenPredictor?.switchModelUsageThreshold ?? 0.95,
      delegateConsecutiveHighBurn:
        full.tokenPredictor?.delegateConsecutiveHighBurn ?? 5,
    },
    scoring: {
      ...baseScoring,
      ...(full.scoring?.continueThreshold !== undefined
        ? { continueThreshold: full.scoring.continueThreshold }
        : {}),
      ...(full.scoring?.warnThreshold !== undefined
        ? { warnThreshold: full.scoring.warnThreshold }
        : {}),
      ...(full.scoring?.escalateThreshold !== undefined
        ? { escalateThreshold: full.scoring.escalateThreshold }
        : {}),
      ...(full.scoring?.stopThreshold !== undefined
        ? { stopThreshold: full.scoring.stopThreshold }
        : {}),
    },
    closedLoop: {
      ...baseClosedLoop,
      ...(full.closedLoop?.saveDecisions !== undefined
        ? { saveDecisions: full.closedLoop.saveDecisions }
        : {}),
    },
    decision: {
      ...baseDecision,
      ...(full.decision?.maxHistoryPerSession !== undefined
        ? { maxHistoryPerSession: full.decision.maxHistoryPerSession }
        : {}),
      ...(full.decision?.forceContinueAfterStops !== undefined
        ? { forceContinueAfterStops: full.decision.forceContinueAfterStops }
        : {}),
    },
  }
}

/**
 * Check whether the MetaGovernor is enabled. Returns false if config is undefined.
 */
export function isMetaGovernorEnabled(
  config: MetaGovernorConfig | undefined,
): boolean {
  return config?.enabled === true
}
