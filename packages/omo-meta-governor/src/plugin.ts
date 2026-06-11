import type { Hooks, Plugin, PluginInput } from "@opencode-ai/plugin"
import type {
  AgentmemoryWriteBackend,
  MemoryBackends,
  MetaGovernorInput,
} from "./types"
import { runMetaGovernor } from "./orchestrator"
import { loadOrchestratorConfig, type MetaGovernorPluginConfig } from "./config"

/**
 * Dependencies required by the MetaGovernor plugin.
 * All are optional — features degrade gracefully when backends are unavailable.
 */
export interface MetaGovernorPluginDeps {
  /** Backends for reading memory (agentmemory, magic-context, boulder-state). Optional — degrades gracefully. */
  backends?: MemoryBackends
  /** Backend for writing lessons/decisions back to agentmemory. Optional — degrades gracefully. */
  writeBackend?: AgentmemoryWriteBackend
  /** Provider ID for the current session (for token predictor). */
  providerID?: () => string | undefined
  /** Model ID for the current session (for token predictor). */
  modelID?: () => string | undefined
}

/**
 * Create a MetaGovernor plugin that registers a `tool.execute.after` hook.
 *
 * The plugin observes every tool call, runs the MetaGovernor pipeline,
 * and dispatches decisions (continue/warn/escalate/stop).
 */
export function createMetaGovernorPlugin(
  deps: MetaGovernorPluginDeps = {},
): Plugin {
  const plugin: Plugin = async (
    input: PluginInput,
  ): Promise<Hooks> => {
    // 1. Load config from plugin input or environment
    const rawConfig = (input.config?.meta_governor ?? {}) as MetaGovernorPluginConfig
    const config = loadOrchestratorConfig(rawConfig)

    // 2. If disabled, return empty hooks
    if (!config.enabled) {
      return {}
    }

    // 3. Register tool.execute.after hook
    return {
      "tool.execute.after": async (
        toolInput: { tool: string; sessionID: string; callID: string },
        toolOutput: { title: string; output: string; metadata: unknown },
      ): Promise<void> => {
        // Feature flag
        if (!config.enabled) return

        // Build the orchestrator input from available signals
        const orchestratorInput: MetaGovernorInput = {
          sessionID: toolInput.sessionID,
          toolName: toolInput.tool,
          toolOutput: toolOutput.output,
          iteration: 0,
          maxIterations: 10,
          oracleVerified: false,
          noProgress: false,
          filesChanged: 0,
          recentTurnTokens: [],
          deviations: [],
          backends: deps.backends ?? {
            agentmemory: {
              smartSearch: async () => ({ lessons: [], crystals: [] }),
            },
            magicContext: {
              slotList: async () => [],
            },
            boulderState: {
              boulderRead: async () => [],
            },
          },
          writeBackend: deps.writeBackend ?? {
            saveMemory: async () => ({ id: "" }),
            saveLesson: async () => ({ id: "" }),
          },
          config,
          ...(deps.providerID ? { providerID: deps.providerID() } : {}),
          ...(deps.modelID ? { modelID: deps.modelID() } : {}),
        }

        // Run the orchestrator (fire-and-forget — never block the tool chain)
        try {
          await runMetaGovernor(orchestratorInput)
        } catch (err) {
          // MetaGovernor must NEVER break a tool call.
          // Log the error but swallow it.
          if (typeof console !== "undefined") {
            console.error("[meta-governor] orchestrator error:", err)
          }
        }
      },
    }
  }

  return plugin
}
