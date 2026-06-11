import type { OrchestratorConfig } from "./types"
import { defaultScoringConfig } from "./scoring-engine"
import { defaultDecisionHandlerConfig } from "./decision-handler"
import { defaultClosedLoopConfig } from "./closed-loop-learning"

/**
 * MetaGovernor config schema exposed to users.
 * This is a Zod-free config interface since Zod parsing is optional
 * in the standalone plugin — the user provides JSON, we coerce with defaults.
 */
export interface MetaGovernorPluginConfig {
  /** Master feature flag — must be true to run the orchestrator. */
  enabled?: boolean

  /** Decision handler (PR 6) */
  decision?: {
    maxHistoryPerSession?: number
    forceContinueAfterStops?: number
  }

  /** Memory aggregator (PR 2) */
  memory?: {
    agentmemoryTimeoutMs?: number
    magicContextTimeoutMs?: number
    boulderStateTimeoutMs?: number
    query?: string
  }

  /** Token predictor (PR 4) */
  tokenPredictor?: {
    compactBurnRateThreshold?: number
    compactUsageThreshold?: number
    switchModelUsageThreshold?: number
    delegateConsecutiveHighBurn?: number
  }

  /** Scoring engine (PR 5) */
  scoring?: {
    continueThreshold?: number
    warnThreshold?: number
    escalateThreshold?: number
    stopThreshold?: number
  }

  /** Closed-loop learning (PR 3) */
  closedLoop?: {
    saveDecisions?: boolean
    saveLessons?: boolean
  }
}

/**
 * Project the full MetaGovernorPluginConfig into OrchestratorConfig.
 * Missing sub-configs fall back to module defaults.
 */
export function loadOrchestratorConfig(
  pluginConfig: Partial<MetaGovernorPluginConfig> | undefined,
): OrchestratorConfig {
  const full: MetaGovernorPluginConfig = {
    enabled: false,
    ...pluginConfig,
  }

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
  config: MetaGovernorPluginConfig | undefined,
): boolean {
  return config?.enabled === true
}
