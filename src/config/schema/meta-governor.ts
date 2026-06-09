import { z } from "zod"

/**
 * MetaGovernor config — see .omo/plans/meta-governor.md.
 *
 * PR 8 of 8. Wires the orchestrator into the plugin via a feature flag.
 * Default: `enabled: false` (opt-in).
 *
 * Note: nested object defaults are function-form because Zod v4 requires
 * the call form when the inner object has its own .default() values.
 */
export const MetaGovernorConfigSchema = z.object({
  /** Master feature flag — must be true to run the orchestrator. */
  enabled: z.boolean().default(false),

  /** Decision handler (PR 6) */
  decision: z
    .object({
      maxHistoryPerSession: z.number().int().min(1).default(50),
      forceContinueAfterStops: z.number().int().min(1).default(3),
    })
    .default(() => ({ maxHistoryPerSession: 50, forceContinueAfterStops: 3 })),

  /** Memory aggregator (PR 2) */
  memory: z
    .object({
      agentmemoryTimeoutMs: z.number().int().min(100).default(2000),
      magicContextTimeoutMs: z.number().int().min(100).default(1000),
      boulderStateTimeoutMs: z.number().int().min(100).default(1000),
      query: z.string().default("meta_governor_context"),
    })
    .default(() => ({
      agentmemoryTimeoutMs: 2000,
      magicContextTimeoutMs: 1000,
      boulderStateTimeoutMs: 1000,
      query: "meta_governor_context",
    })),

  /** Token predictor (PR 4) */
  tokenPredictor: z
    .object({
      compactBurnRateThreshold: z.number().int().min(1).default(500),
      compactUsageThreshold: z.number().min(0).max(1).default(0.85),
      switchModelUsageThreshold: z.number().min(0).max(1).default(0.95),
      delegateConsecutiveHighBurn: z.number().int().min(1).default(5),
    })
    .default(() => ({
      compactBurnRateThreshold: 500,
      compactUsageThreshold: 0.85,
      switchModelUsageThreshold: 0.95,
      delegateConsecutiveHighBurn: 5,
    })),

  /** Scoring engine (PR 5) */
  scoring: z
    .object({
      continueThreshold: z.number().min(-1).max(1).default(0.3),
      warnThreshold: z.number().min(0).max(1).default(0.3),
      escalateThreshold: z.number().min(0).max(1).default(0.6),
      stopThreshold: z.number().min(0).max(1).default(0.8),
    })
    .default(() => ({
      continueThreshold: 0.3,
      warnThreshold: 0.3,
      escalateThreshold: 0.6,
      stopThreshold: 0.8,
    })),

  /** Closed-loop learning (PR 3) */
  closedLoop: z
    .object({
      saveDecisions: z.boolean().default(true),
      saveLessons: z.boolean().default(true),
    })
    .default(() => ({ saveDecisions: true, saveLessons: true })),
})

export type MetaGovernorConfig = z.infer<typeof MetaGovernorConfigSchema>
