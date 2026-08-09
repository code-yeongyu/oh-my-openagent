import type { CategoryConfig } from "../config/schema"
import type { DelegatedModelConfig } from "./model-resolution-types"

export function applyCategoryParams(
  base: DelegatedModelConfig,
  config: CategoryConfig | undefined,
): DelegatedModelConfig {
  if (!config) return base

  const providerOptions = {
    ...(config.textVerbosity === undefined ? {} : { textVerbosity: config.textVerbosity }),
    ...config.provider_options,
  }

  return {
    ...base,
    ...(config.reasoning !== undefined
      ? { reasoning: config.reasoning }
      : config.reasoningEffort !== undefined
        ? { reasoningEffort: config.reasoningEffort }
        : {}),
    ...(config.temperature !== undefined ? { temperature: config.temperature } : {}),
    ...(config.top_p !== undefined ? { top_p: config.top_p } : {}),
    ...(config.max_tokens !== undefined || config.maxTokens !== undefined
      ? { maxTokens: config.max_tokens ?? config.maxTokens }
      : {}),
    ...(Object.keys(providerOptions).length > 0 ? { providerOptions } : {}),
    ...(config.thinking !== undefined ? { thinking: config.thinking } : {}),
    ...(config.tools !== undefined ? { tools: config.tools } : {}),
  }
}
