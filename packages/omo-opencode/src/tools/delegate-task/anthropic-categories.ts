import type { BuiltinCategoryDefinition } from "./builtin-category-definition"

const UNSPECIFIED_HIGH_CATEGORY_PROMPT_APPEND = `<Category_Context>
You are working on tasks that don't fit specific categories but require substantial effort.
</Category_Context>`

const UNSPECIFIED_HIGH_CATEGORY_CALLER_GUIDANCE = `<Selection_Gate>Use only when no specialist category fits and substantial effort spans systems/modules with broad impact. Use unspecified-low for contained moderate work.</Selection_Gate>`

export const ANTHROPIC_CATEGORIES: BuiltinCategoryDefinition[] = [
  {
    name: "unspecified-high",
    config: { model: "anthropic/claude-opus-5", variant: "xhigh" },
    description: "Tasks that don't fit other categories, high effort required",
    callerGuidance: UNSPECIFIED_HIGH_CATEGORY_CALLER_GUIDANCE,
    promptAppend: UNSPECIFIED_HIGH_CATEGORY_PROMPT_APPEND,
  },
]
