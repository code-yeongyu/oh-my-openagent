import type { BuiltinCategoryDefinition } from "./builtin-category-definition"

const UNSPECIFIED_LOW_CATEGORY_PROMPT_APPEND = `<Category_Context>
You are working on tasks that don't fit specific categories but require moderate effort.

<Selection_Gate>
BEFORE selecting this category, VERIFY ALL conditions:
1. Task does NOT fit: quick (trivial), visual-engineering (UI), ultrabrain (deep logic), artistry (creative), writing (docs)
2. Task requires more than trivial effort but is NOT system-wide
3. Scope is contained within a few files/modules

If task fits ANY other category, DO NOT select unspecified-low.
This is NOT a default choice - it's for genuinely unclassifiable moderate-effort work.
</Selection_Gate>
</Category_Context>

<Caller_Warning>
THIS CATEGORY USES A MID-TIER MODEL (claude-sonnet-4-6).

**PROVIDE CLEAR STRUCTURE:**
1. MUST DO: Enumerate required actions explicitly
2. MUST NOT DO: State forbidden actions to prevent scope creep
3. EXPECTED OUTPUT: Define concrete success criteria
</Caller_Warning>`

const UNSPECIFIED_HIGH_CATEGORY_PROMPT_APPEND = `<Category_Context>
You are working on tasks that don't fit specific categories but require substantial effort.

<Selection_Gate>
BEFORE selecting this category, VERIFY ALL conditions:
1. Task does NOT fit: quick (trivial), visual-engineering (UI), ultrabrain (deep logic), artistry (creative), writing (docs)
2. Task requires substantial effort across multiple systems/modules
3. Changes have broad impact or require careful coordination
4. NOT just "complex" - must be genuinely unclassifiable AND high-effort

If task fits ANY other category, DO NOT select unspecified-high.
If task is unclassifiable but moderate-effort, use unspecified-low instead.
</Selection_Gate>
</Category_Context>`

export const ANTHROPIC_CATEGORIES: BuiltinCategoryDefinition[] = [
  {
    name: "unspecified-low",
    config: { model: "anthropic/claude-sonnet-4-6" },
    description: "Tasks that don't fit other categories, low effort required",
    promptAppend: UNSPECIFIED_LOW_CATEGORY_PROMPT_APPEND,
  },
  {
    name: "unspecified-high",
    config: { model: "anthropic/claude-opus-4-6", variant: "max" },
    description: "Tasks that don't fit other categories, high effort required",
    promptAppend: UNSPECIFIED_HIGH_CATEGORY_PROMPT_APPEND,
  },
]
