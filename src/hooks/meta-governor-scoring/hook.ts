/**
 * MetaGovernor Scoring Engine Hook — PR 5 of 8.
 *
 * Fires on tool.execute.after. After each tool call, assembles a
 * DecisionContext from available signals and runs the scoring engine.
 * Records the result in ambient state for downstream consumers
 * (closed-loop learning, escalation, etc.).
 *
 * Pattern: same factory as edit-error-recovery / closed-loop hooks.
 */

import type { PluginInput } from "@opencode-ai/plugin"
import { score, defaultScoringConfig } from "../../features/meta-governor/scoring-engine"
import type { ScoringConfig, DecisionContext, SlotMemory } from "../../features/meta-governor/types"

/**
 * Configuration for the scoring hook. Defaults to sensible values.
 */
/**
 * Configuration for the scoring hook. Defaults to sensible values.
 */
export function createMetaGovernorScoringHook(config?: Partial<ScoringConfig>) {
  const resolvedConfig = { ...defaultScoringConfig(), ...config }

  return {
    "tool.execute.after": async (
      input: { tool: string; sessionID: string; callID: string },
      output: { title: string; output: string; metadata: unknown },
    ) => {
      // Build a minimal DecisionContext from observable signals.
      // The full context is assembled by the orchestrator in PR 7.
      // This hook provides the scoring call site.

      const slotMemory: SlotMemory = {
        consecutiveStops: 0,
        consecutiveContinues: 0,
        lastUpdatedISO: new Date().toISOString(),
      }

      const ctx: DecisionContext = {
        oracleVerified: false,
        noProgress: false,
        deviations: [],
        iterationRatio: 0,
        lessonsRelevant: [],
        slotMemory,
        ambient: {
          sessionID: input.sessionID,
          directory: process.cwd(),
          mode: "ultrawork",
          agentName: "sisyphus",
          iteration: 0,
          maxIterations: 20,
        },
      }

      // Run scoring
      const result = score(ctx, resolvedConfig)

      // Return scoring result for downstream hooks to consume
      return {
        metaGovernorScoring: {
          action: result.decision.action,
          score: result.decision.score,
          paralysisOverride: result.paralysisOverride,
          tool: input.tool,
          computedAtISO: result.computedAtISO,
        },
      }
    },
  }
}
