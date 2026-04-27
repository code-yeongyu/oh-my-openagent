import type { BuiltinCategoryDefinition } from "./builtin-category-definition"

const UNSPECIFIED_LOW_CATEGORY_PROMPT_APPEND = `<ctx>
Moderate-effort tasks that don't fit other categories.

<gate>
Select ONLY if ALL true:
1. Does NOT fit: quick, visual-engineering, ultrabrain, artistry, writing
2. Requires non-trivial effort
3. Scope: few files/modules

NOT a default. Genuinely unclassifiable only.
</gate>
</ctx>

<warn>
MID-TIER model (claude-sonnet-4-6). Provide clear structure:
- MUST DO: enumerate required actions
- MUST NOT DO: state forbidden actions
- EXPECTED OUTPUT: concrete success criteria
</warn>`

const UNSPECIFIED_HIGH_CATEGORY_PROMPT_APPEND = `<ctx>
Substantial-effort tasks that don't fit other categories, with broad impact.

<gate>
Select ONLY if ALL true:
1. Does NOT fit: quick, visual-engineering, ultrabrain, artistry, writing
2. Substantial effort across multiple systems/modules
3. Broad impact or requires careful coordination
4. Genuinely unclassifiable AND high-effort (not just "complex")

NOT a default. Use unspecified-low for moderate effort.
</gate>
</ctx>`

export const ANTHROPIC_CATEGORIES: BuiltinCategoryDefinition[] = [
  {
    name: "unspecified-low",
    config: { model: "anthropic/claude-sonnet-4-6" },
    description: "Tasks that don't fit other categories, low effort required",
    promptAppend: UNSPECIFIED_LOW_CATEGORY_PROMPT_APPEND,
  },
  {
    name: "unspecified-high",
    config: { model: "anthropic/claude-opus-4-7", variant: "max" },
    description: "Tasks that don't fit other categories, high effort required",
    promptAppend: UNSPECIFIED_HIGH_CATEGORY_PROMPT_APPEND,
  },
]
