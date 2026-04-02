import type { AvailableCategory } from "../agents/dynamic-agent-prompt-builder"
import type { OhMyOpenCodeConfig } from "../config"
import { CATEGORY_DESCRIPTIONS } from "../tools/delegate-task/constants"
import { mergeCategories } from "../shared/merge-categories"

export function createAvailableCategories(
  pluginConfig: OhMyOpenCodeConfig,
): AvailableCategory[] {
  const categories = mergeCategories(pluginConfig.categories)

  return Object.entries(categories).map(([name, categoryConfig]) => {
    const model =
      typeof categoryConfig.model === "string" ? categoryConfig.model : undefined
    const displayName = categoryConfig.display_name

    return {
      name,
      description:
        categoryConfig.description ??
        CATEGORY_DESCRIPTIONS[name] ??
        "General tasks",
      model,
      ...(displayName !== undefined && { displayName }),
    }
  })
}
