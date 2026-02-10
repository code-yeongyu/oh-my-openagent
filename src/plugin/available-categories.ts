import type { AvailableCategory } from "../agents/dynamic-agent-prompt-builder"
import type { OhMyOpenCodeConfig } from "../config"

import {
  CATEGORY_DESCRIPTIONS,
  DEFAULT_CATEGORIES,
} from "../tools/delegate-task/constants"

export function createAvailableCategories(
  pluginConfig: OhMyOpenCodeConfig,
): AvailableCategory[] {
  const mergedCategories = pluginConfig.categories
    ? { ...DEFAULT_CATEGORIES, ...pluginConfig.categories }
    : DEFAULT_CATEGORIES

  return Object.entries(mergedCategories).map(([name, categoryConfig]) => {
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
