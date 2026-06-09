import type { PluginInput } from "@opencode-ai/plugin"
import type { MetaGovernorConfig } from "../../config/schema/meta-governor"
import type { AgentmemoryWriteBackend, MemoryBackends, MetaGovernorInput } from "../../features/meta-governor/types"
import { runMetaGovernor } from "../../features/meta-governor/orchestrator"
import { loadOrchestratorConfig } from "../../features/meta-governor/config"
/**
 * MetaGovernor Integration Hook — PR 8 of 8.
 *
 * Wires the orchestrator into `tool.execute.after`. After each tool call,
 * builds a `MetaGovernorInput` from the tool call context and dispatches
 * through `runMetaGovernor()`. Results are logged but NOT auto-applied —
 * the orchestrator returns actions, and a separate consumer (e.g. message
 * injection) decides what to do with them.
 *
 * When `meta_governor.enabled` is `false`, this hook is a no-op.
 */

export interface MetaGovernorIntegrationDeps {
  /** Backends for reading memory (agentmemory, magic-context, boulder-state). */
  backends: MemoryBackends
  /** Backend for writing lessons/decisions back to agentmemory. */
  writeBackend: AgentmemoryWriteBackend
  /** Current MetaGovernor config (undefined → no-op). */
  config: MetaGovernorConfig | undefined
  /** Provider ID for the current session (for token predictor). */
  providerID: () => string | undefined
  /** Model ID for the current session (for token predictor). */
  modelID: () => string | undefined
}

export function createMetaGovernorIntegrationHook(
  _ctx: PluginInput,
  deps: MetaGovernorIntegrationDeps,
) {
  return {
    "tool.execute.after": async (
      input: { tool: string; sessionID: string; callID: string },
      output: { title: string; output: string; metadata: unknown },
    ): Promise<void> => {
      // Feature flag gate
      if (!deps.config?.enabled) return

      // Skip if no backends available
      if (!deps.backends) return

      // Build the orchestrator input from available signals
      const orchestratorInput: MetaGovernorInput = {
        sessionID: input.sessionID,
        toolName: input.tool,
        toolOutput: output.output,
        iteration: 0,
        maxIterations: 10,
        oracleVerified: false,
        noProgress: false,
        filesChanged: 0,
        recentTurnTokens: [],
        deviations: [],
        backends: deps.backends,
        writeBackend: deps.writeBackend,
        config: loadOrchestratorConfig(deps.config),
        ...(deps.providerID() ? { providerID: deps.providerID()! } : {}),
        ...(deps.modelID() ? { modelID: deps.modelID()! } : {}),
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
