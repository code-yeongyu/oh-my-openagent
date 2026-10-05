import type { CategoryConfig } from "../../config/schema"
import type { BuiltinCategoryDefinition } from "./builtin-category-definition"
import { GOOGLE_CATEGORIES } from "./google-categories"
import { KIMI_CATEGORIES } from "./kimi-categories"
import { OPENAI_CATEGORIES } from "./openai-categories"

const BUILTIN_CATEGORIES: BuiltinCategoryDefinition[] = [
  ...GOOGLE_CATEGORIES,
  ...OPENAI_CATEGORIES,
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

export const CATEGORY_CALLER_GUIDANCE: Record<string, string | undefined> = buildCategoryRecord(
  (definition) => definition.callerGuidance
)

export const CATEGORY_PROMPT_APPEND_RESOLVERS: Record<string, (model: string | undefined) => string> = Object.fromEntries(
  BUILTIN_CATEGORIES
    .filter((definition) => definition.resolvePromptAppend !== undefined)
    .map((definition) => [definition.name, definition.resolvePromptAppend!]),
)

// Gate models mirrored from senpi-task's builtins.ts requiresModel plumbing: CATEGORY_MODEL_REQUIREMENTS
// (model-core) wins when it carries its own requiresModel; this record covers builtin categories whose
// gate is declared only on the definition (deep). A gate lists every id that opens the category; one
// present id is enough, so deep stays available on a registry carrying either GPT flagship.
export const BUILTIN_CATEGORY_REQUIRES_MODEL: Record<string, readonly string[]> = Object.fromEntries(
  BUILTIN_CATEGORIES
    .filter((definition) => definition.requiresModel !== undefined)
    .map((definition) => [
      definition.name,
      typeof definition.requiresModel === "string" ? [definition.requiresModel] : definition.requiresModel!,
    ]),
)

export function builtinCategoryGateModels(categoryName: string, requirementGateModel: string | undefined): readonly string[] {
  if (requirementGateModel !== undefined) return [requirementGateModel]
  return BUILTIN_CATEGORY_REQUIRES_MODEL[categoryName] ?? []
}
