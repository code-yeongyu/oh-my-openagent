import type { PluginInput } from "@opencode-ai/plugin"

import type { MetaGovernorConfig } from "../../config/schema/meta-governor"
import { runMetaGovernor } from "../../features/meta-governor"

export interface MetaGovernorHookOptions {
  config?: MetaGovernorConfig
}

export function createMetaGovernorHook(_ctx: PluginInput, options: MetaGovernorHookOptions = {}) {
  const config = options.config ?? { enabled: false, hook_enabled: true, observed_tools: ["edit", "bash", "task"] }

  if (!config.enabled) {
    return {}
  }

  const observedSet = new Set(config.observed_tools.map((t) => t.toLowerCase()))

  return {
    "tool.execute.after": async (
      input: { tool: string; sessionID: string; callID: string },
      output: { title: string; output: string; metadata: unknown },
    ) => {
      if (!config.hook_enabled) return
      if (!observedSet.has(input.tool.toLowerCase())) return
      if (typeof output.output !== "string") return

      // Minimal integration: just prove the orchestrator is reachable.
      // Full integration (backends, writeBackend, deviations) lands after PRs 2-7 merge.
      const result = await runMetaGovernor(
        {
          sessionID: input.sessionID,
          toolName: input.tool,
          iteration: 1,
          maxIterations: 10,
          oracleVerified: false,
          noProgress: false,
          filesChanged: 0,
          recentTurnTokens: [],
          deviations: [],
          backends: {
            agentmemory: { smartSearch: async () => ({ lessons: [], crystals: [] }) },
            magicContext: { slotList: async () => [] },
            boulderState: { boulderRead: async () => [] },
          },
          writeBackend: {
            saveMemory: async () => ({ id: "" }),
            saveLesson: async () => ({ id: "" }),
          },
        },
        { enabled: true },
      )

      if (result.decision.action !== "continue" && result.decision.message) {
        output.output += `\n${result.decision.message}`
      }
    },
  }
}
