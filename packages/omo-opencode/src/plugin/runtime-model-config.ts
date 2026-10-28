import type { OhMyOpenCodeConfig } from "../config"
import { validatePluginConfig } from "../config/validate"
import { log } from "../shared/logger"

/** Each accepted reload replaces the snapshot; existing dispatches keep their resolved config. */
export function createRuntimeModelConfigLoader(
  directory: string,
  initialConfig: OhMyOpenCodeConfig,
): () => Pick<OhMyOpenCodeConfig, "agents" | "categories"> {
  let current = { agents: initialConfig.agents, categories: initialConfig.categories }

  return () => {
    try {
      const validation = validatePluginConfig(directory)
      // Invalid leaves can be pruned with only a warning. Never accept that partial edit.
      if (!validation.valid || validation.messages.length > 0 || validation.warnings.length > 0) {
        log("[runtime-model-config] Reload rejected; keeping the last valid model config", {
          messages: validation.messages,
          warnings: validation.warnings,
        })
        return current
      }
      current = { agents: validation.config.agents, categories: validation.config.categories }
    } catch (error) {
      log("[runtime-model-config] Reload failed; keeping the last valid model config", {
        error: error instanceof Error ? error.message : String(error),
      })
    }
    return current
  }
}
