import type { CategoryConfig } from "../../config/schema"
import { ANTHROPIC_CATEGORIES } from "./anthropic-categories"
import type { BuiltinCategoryDefinition } from "./builtin-category-definition"
import { GOOGLE_CATEGORIES } from "./google-categories"
import { KIMI_CATEGORIES } from "./kimi-categories"
import { OPENAI_CATEGORIES } from "./openai-categories"

const BUILTIN_CATEGORIES: BuiltinCategoryDefinition[] = [
  ...GOOGLE_CATEGORIES,
  ...OPENAI_CATEGORIES,
  ...ANTHROPIC_CATEGORIES,
  ...KIMI_CATEGORIES,
]

function buildCategoryRecord<TValue>(
  selector: (definition: BuiltinCategoryDefinition) => TValue
): Record<string, TValue> {
  return Object.fromEntries(
    BUILTIN_CATEGORIES.map((definition) => [definition.name, selector(definition)])
  )
}

export const DEFAULT_CATEGORIES: Record<string, CategoryConfig> = buildCategoryRecord(
  (definition) => definition.config
)

export const CATEGORY_PROMPT_APPENDS: Record<string, string> = buildCategoryRecord(
  (definition) => definition.promptAppend
)

export const CATEGORY_DESCRIPTIONS: Record<string, string> = buildCategoryRecord(
  (definition) => definition.description
)
