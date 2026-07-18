import type { OmoCategoryConfig } from "@oh-my-opencode/omo-config-core"

import { ANTHROPIC_CATEGORIES } from "./anthropic-categories"
import { GOOGLE_CATEGORIES } from "./google-categories"
import { KIMI_CATEGORIES } from "./kimi-categories"
import { OPENAI_CATEGORIES } from "./openai-categories"
import type { BuiltinCategoryDefinition } from "./types"

// Ported from packages/omo-opencode/src/tools/delegate-task/builtin-categories.ts.
export const BUILTIN_CATEGORY_DEFAULTS: readonly BuiltinCategoryDefinition[] = [
  ...GOOGLE_CATEGORIES,
  ...OPENAI_CATEGORIES,
  ...ANTHROPIC_CATEGORIES,
  ...KIMI_CATEGORIES,
] as const

export const DEFAULT_CATEGORIES: Readonly<Record<string, OmoCategoryConfig>> = Object.fromEntries(
  BUILTIN_CATEGORY_DEFAULTS.map((definition) => [definition.name, definition.config]),
)

export const CATEGORY_DESCRIPTIONS: Readonly<Record<string, string>> = Object.fromEntries(
  BUILTIN_CATEGORY_DEFAULTS.map((definition) => [definition.name, definition.description]),
)

export const CATEGORY_PROMPT_APPENDS: Readonly<Record<string, string>> = Object.fromEntries(
  BUILTIN_CATEGORY_DEFAULTS.map((definition) => [definition.name, definition.promptAppend]),
)

export const CATEGORY_PROMPT_APPEND_RESOLVERS: Readonly<Record<string, (model: string | undefined) => string>> =
  Object.fromEntries(
    BUILTIN_CATEGORY_DEFAULTS
      .filter(hasPromptAppendResolver)
      .map((definition) => [definition.name, definition.resolvePromptAppend]),
  )

function hasPromptAppendResolver(
  definition: BuiltinCategoryDefinition,
): definition is BuiltinCategoryDefinition & { readonly resolvePromptAppend: (model: string | undefined) => string } {
  return definition.resolvePromptAppend !== undefined
}
