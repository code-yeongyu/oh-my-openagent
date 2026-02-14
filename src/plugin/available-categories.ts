import type { AvailableCategory } from "../agents/dynamic-agent-prompt-builder"
import type { MatrixxConfig } from "../config"
import { CATEGORY_DESCRIPTIONS } from "../tools/delegate-task/constants"
import { mergeCategories } from "../shared/merge-categories"

export function createAvailableCategories(
  pluginConfig: MatrixxConfig,
): AvailableCategory[] {
  const categories = mergeCategories(pluginConfig.categories)

  return Object.entries(categories).map(([name, categoryConfig]) => {
    const model =
      typeof categoryConfig.model === "string" ? categoryConfig.model : undefined

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
