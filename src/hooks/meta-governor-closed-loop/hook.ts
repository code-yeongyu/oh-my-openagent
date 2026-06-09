/**
 * MetaGovernor closed-loop learning hook.
 *
 * Fires on tool.execute.after. Observes every tool outcome and decides
 * whether to persist a lesson to agentmemory for future sessions.
 *
 * Pattern: same factory as edit-error-recovery (PR 3 reference hook).
 */

import type { PluginInput } from "@opencode-ai/plugin"
import { observeAndLearn, defaultClosedLoopConfig } from "../../features/meta-governor/closed-loop-learning"
import type { ClosedLoopConfig, Decision, MemoryRead } from "../../features/meta-governor/types"

/**
 * Configuration for the closed-loop hook. Defaults to sensible values.
 */
export function createMetaGovernorClosedLoopHook(_ctx: PluginInput, config?: ClosedLoopConfig) {
  const resolvedConfig: ClosedLoopConfig = config ?? defaultClosedLoopConfig()

  return {
    "tool.execute.after": async (
      input: { tool: string; sessionID: string; callID: string },
      output: { title: string; output: string; metadata: unknown }
    ) => {
      // Only observe tools that produce errors or indicate deviation
      if (input.tool.toLowerCase() !== "edit" && input.tool.toLowerCase() !== "bash") return
      if (typeof output.output !== "string") return

      const outputLower = output.output.toLowerCase()

      // Detect error patterns that signal deviation
      const hasDeviation =
        outputLower.includes("error") ||
        outputLower.includes("failed") ||
        outputLower.includes("denied")

      if (!hasDeviation) return

      // Build a minimal Decision from the observed outcome
      const decision: Decision = {
        action: "warn",
        score: -0.5,
        reasoning: `Tool ${input.tool} produced error output: ${output.output.slice(0, 200)}`,
        evidence: [
          {
            source: "deviation-detector",
            value: `${input.tool}-error`,
            confidence: 0.7,
            weight: 0.5,
          },
        ],
        shouldEscalateTo: null,
      }

      // Minimal MemoryRead (the hook doesn't read memory — it only writes)
      const memoryRead: MemoryRead = {
        query: "",
        timestampISO: new Date().toISOString(),
        agentmemory: { available: true, lessons: [] },
        magicContext: { available: true, slots: [] },
        boulderState: { available: true, tasks: [], planProgress: 0 },
        degradedSources: [],
      }

      try {
        // The real backend would be injected via DI at wiring time.
        // For now, we log the learning attempt. PR 7 (integration) will
        // wire the real agentmemory_write backend.
        void await observeAndLearn(
          {
            decision,
            memoryRead,
            config: resolvedConfig,
            sessionID: input.sessionID,
            directory: process.cwd(),
            filesChanged: [],
          },
          {
            saveMemory: async () => ({ id: "pending-impl" }),
            saveLesson: async () => ({ id: "pending-impl" }),
          }
        )
      } catch {
        // Non-fatal: learning failures must not break tool execution
      }
    },
  }
}
