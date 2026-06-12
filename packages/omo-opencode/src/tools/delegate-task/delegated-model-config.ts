import type { CategoryConfig } from "../../config/schema"
import type { DelegatedModelConfig } from "./types"

export function applyCategoryParams(
  base: DelegatedModelConfig,
  config: CategoryConfig | undefined,
): DelegatedModelConfig {
  if (!config) {
    return base
  }

  return {
    ...base,
    ...(config.reasoningEffort !== undefined ? { reasoningEffort: config.reasoningEffort } : {}),
    ...(config.temperature !== undefined ? { temperature: config.temperature } : {}),
    ...(config.top_p !== undefined ? { top_p: config.top_p } : {}),
    ...(config.maxTokens !== undefined ? { maxTokens: config.maxTokens } : {}),
    ...(config.thinking !== undefined ? { thinking: config.thinking } : {}),
  }
}
