import { CATEGORY_DESCRIPTIONS, CATEGORY_PROMPT_APPENDS, DEFAULT_CATEGORIES } from "../tools/delegate-task/constants"

export type TargetCategoryDefinition = {
  name: string
  description: string
  promptAppend: string
  model?: string
  variant?: string
}

export function createTargetCategoryInventory(): readonly TargetCategoryDefinition[] {
  return Object.entries(DEFAULT_CATEGORIES).map(([name, config]) => ({
    name,
    description: CATEGORY_DESCRIPTIONS[name] ?? "General tasks",
    promptAppend: CATEGORY_PROMPT_APPENDS[name] ?? "",
    model: config.model,
    variant: config.variant,
  }))
}
