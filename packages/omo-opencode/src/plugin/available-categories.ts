import type { AvailableCategory } from "../agents/dynamic-agent-prompt-builder"
import type { OhMyOpenCodeConfig } from "../config"
import { CATEGORY_DESCRIPTIONS } from "../tools/delegate-task/constants"
import { mergeCategories } from "../shared/merge-categories"
import { resolveEffectiveModelChain } from "../shared/effective-model-chain"

export function createAvailableCategories(
  pluginConfig: OhMyOpenCodeConfig,
): AvailableCategory[] {
  const categories = mergeCategories(pluginConfig.categories)

  return Object.entries(categories).map(([name, categoryConfig]) => {
    const model = resolveEffectiveModelChain(categoryConfig).primaryModel

    return {
      name,
      description:
        pluginConfig.categories?.[name]?.description ??
        CATEGORY_DESCRIPTIONS[name] ??
        "General tasks",
      model,
    }
  })
}
