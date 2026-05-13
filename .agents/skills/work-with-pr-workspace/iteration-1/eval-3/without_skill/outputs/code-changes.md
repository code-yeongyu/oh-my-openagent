# Code Changes

## 1. NEW: `src/tools/delegate-task/default-categories.ts`

```typescript
import type { CategoryConfig } from "../../config/schema"

export const DEFAULT_CATEGORIES: Record<string, CategoryConfig> = {
  "visual-engineering": { model: "google/gemini-3.1-pro", variant: "high" },
  ultrabrain: { model: "openai/gpt-5.4", variant: "xhigh" },
  deep: { model: "openai/gpt-5.3-codex", variant: "medium" },
  artistry: { model: "google/gemini-3.1-pro", variant: "high" },
  quick: { model: "anthropic/claude-haiku-4-5" },
  "unspecified-low": { model: "anthropic/claude-sonnet-4-6" },
  "unspecified-high": { model: "anthropic/claude-opus-4-6", variant: "max" },
  writing: { model: "kimi-for-coding/k2p5" },
}
```

## 2. NEW: `src/tools/delegate-task/category-descriptions.ts`

```typescript
export const CATEGORY_DESCRIPTIONS: Record<string, string> = {
  "visual-engineering": "Frontend, UI/UX, design, styling, animation",
  ultrabrain: "Use ONLY for genuinely hard, logic-heavy tasks. Give clear goals only, not step-by-step instructions.",
  deep: "Goal-oriented autonomous problem-solving. Thorough research before action. For hairy problems requiring deep understanding.",
  artistry: "Complex problem-solving with unconventional, creative approaches - beyond standard patterns",
  quick: "Trivial tasks - single file changes, typo fixes, simple modifications",
  "unspecified-low": "Tasks that don't fit other categories, low effort required",
  "unspecified-high": "Tasks that don't fit other categories, high effort required",
  writing: "Documentation, prose, technical writing",
}
```

## 3. NEW: `src/tools/delegate-task/category-prompt-appends.ts`

```typescript
export const VISUAL_CATEGORY_PROMPT_APPEND = `<Category_Context>
You are working on VISUAL/UI tasks.
...
</Category_Context>`

export const ULTRABRAIN_CATEGORY_PROMPT_APPEND = `<Category_Context>
You are working on DEEP LOGICAL REASONING / COMPLEX ARCHITECTURE tasks.
...
</Category_Context>`

export const ARTISTRY_CATEGORY_PROMPT_APPEND = `<Category_Context>
You are working on HIGHLY CREATIVE / ARTISTIC tasks.
...
</Category_Context>`

export const QUICK_CATEGORY_PROMPT_APPEND = `<Category_Context>
You are working on SMALL / QUICK tasks.
...
</Caller_Warning>`

export const UNSPECIFIED_LOW_CATEGORY_PROMPT_APPEND = `<Category_Context>
You are working on tasks that don't fit specific categories but require moderate effort.
...
</Caller_Warning>`

export const UNSPECIFIED_HIGH_CATEGORY_PROMPT_APPEND = `<Category_Context>
You are working on tasks that don't fit specific categories but require substantial effort.
...
</Category_Context>`

export const WRITING_CATEGORY_PROMPT_APPEND = `<Category_Context>
You are working on WRITING / PROSE tasks.
...
</Category_Context>`

export const DEEP_CATEGORY_PROMPT_APPEND = `<Category_Context>
You are working on GOAL-ORIENTED AUTONOMOUS tasks.
...
</Category_Context>`

export const CATEGORY_PROMPT_APPENDS: Record<string, string> = {
  "visual-engineering": VISUAL_CATEGORY_PROMPT_APPEND,
  ultrabrain: ULTRABRAIN_CATEGORY_PROMPT_APPEND,
  deep: DEEP_CATEGORY_PROMPT_APPEND,
  artistry: ARTISTRY_CATEGORY_PROMPT_APPEND,
  quick: QUICK_CATEGORY_PROMPT_APPEND,
  "unspecified-low": UNSPECIFIED_LOW_CATEGORY_PROMPT_APPEND,
  "unspecified-high": UNSPECIFIED_HIGH_CATEGORY_PROMPT_APPEND,
  writing: WRITING_CATEGORY_PROMPT_APPEND,
}
```

> Note: Each `*_CATEGORY_PROMPT_APPEND` contains the full template string from the original. Abbreviated with `...` here for readability. The actual code would contain the complete unmodified prompt text.

## 4. NEW: `src/tools/delegate-task/plan-agent-prompt.ts`

```typescript
import type {
  AvailableCategory,
  AvailableSkill,
} from "../../agents/dynamic-agent-prompt-builder"
import { truncateDescription } from "../../shared/truncate-description"

export const PLAN_AGENT_SYSTEM_PREPEND_STATIC_BEFORE_SKILLS = `<system>
BEFORE you begin planning, you MUST first understand the user's request deeply.
...
</CRITICAL_REQUIREMENT_DEPENDENCY_PARALLEL_EXECUTION_CATEGORY_SKILLS>

<FINAL_OUTPUT_FOR_CALLER>
...
</FINAL_OUTPUT_FOR_CALLER>

`

export const PLAN_AGENT_SYSTEM_PREPEND_STATIC_AFTER_SKILLS = `### REQUIRED OUTPUT FORMAT
...
`

function renderPlanAgentCategoryRows(categories: AvailableCategory[]): string[] {
  const sorted = [...categories].sort((a, b) => a.name.localeCompare(b.name))
  return sorted.map((category) => {
    const bestFor = category.description || category.name
    const model = category.model || ""
    return `| \`${category.name}\` | ${bestFor} | ${model} |`
  })
}

function renderPlanAgentSkillRows(skills: AvailableSkill[]): string[] {
   const sorted = [...skills].sort((a, b) => a.name.localeCompare(b.name))
   return sorted.map((skill) => {
     const domain = truncateDescription(skill.description).trim() || skill.name
     return `| \`${skill.name}\` | ${domain} |`
   })
 }

export function buildPlanAgentSkillsSection(
  categories: AvailableCategory[] = [],
  skills: AvailableSkill[] = []
): string {
  const categoryRows = renderPlanAgentCategoryRows(categories)
  const skillRows = renderPlanAgentSkillRows(skills)

  return `### AVAILABLE CATEGORIES

| Category | Best For | Model |
|----------|----------|-------|
${categoryRows.join("\n")}

### AVAILABLE SKILLS (ALWAYS EVALUATE ALL)

Skills inject specialized expertise into the delegated agent.
YOU MUST evaluate EVERY skill and justify inclusions/omissions.

| Skill | Domain |
|-------|--------|
${skillRows.join("\n")}`
}

export function buildPlanAgentSystemPrepend(
  categories: AvailableCategory[] = [],
  skills: AvailableSkill[] = []
): string {
  return [
    PLAN_AGENT_SYSTEM_PREPEND_STATIC_BEFORE_SKILLS,
    buildPlanAgentSkillsSection(categories, skills),
    PLAN_AGENT_SYSTEM_PREPEND_STATIC_AFTER_SKILLS,
  ].join("\n\n")
}
```

> Note: Template strings abbreviated with `...`. Full unmodified content in the actual file.

## 5. NEW: `src/tools/delegate-task/plan-agent-identity.ts`

```typescript
/**
 * List of agent names that should be treated as plan agents (receive plan system prompt).
 * Case-insensitive matching is used.
 */
export const PLAN_AGENT_NAMES = ["plan"]

/**
 * Check if the given agent name is a plan agent (receives plan system prompt).
 */
export function isPlanAgent(agentName: string | undefined): boolean {
  if (!agentName) return false
  const lowerName = agentName.toLowerCase().trim()
  return PLAN_AGENT_NAMES.some(name => lowerName === name || lowerName.includes(name))
}

/**
 * Plan family: plan + prometheus. Shares mutual delegation blocking and task tool permission.
 * Does NOT share system prompt (only isPlanAgent controls that).
 */
export const PLAN_FAMILY_NAMES = ["plan", "prometheus"]

/**
 * Check if the given agent belongs to the plan family (blocking + task permission).
 */
export function isPlanFamily(category: string): boolean
export function isPlanFamily(category: string | undefined): boolean
export function isPlanFamily(category: string | undefined): boolean {
  if (!category) return false
  const lowerCategory = category.toLowerCase().trim()
  return PLAN_FAMILY_NAMES.some(
    (name) => lowerCategory === name || lowerCategory.includes(name)
  )
}
```

## 6. MODIFIED: `src/tools/delegate-task/constants.ts` (barrel re-export)

```typescript
export { DEFAULT_CATEGORIES } from "./default-categories"
export { CATEGORY_DESCRIPTIONS } from "./category-descriptions"
export {
  VISUAL_CATEGORY_PROMPT_APPEND,
  ULTRABRAIN_CATEGORY_PROMPT_APPEND,
  ARTISTRY_CATEGORY_PROMPT_APPEND,
  QUICK_CATEGORY_PROMPT_APPEND,
  UNSPECIFIED_LOW_CATEGORY_PROMPT_APPEND,
  UNSPECIFIED_HIGH_CATEGORY_PROMPT_APPEND,
  WRITING_CATEGORY_PROMPT_APPEND,
  DEEP_CATEGORY_PROMPT_APPEND,
  CATEGORY_PROMPT_APPENDS,
} from "./category-prompt-appends"
export {
  PLAN_AGENT_SYSTEM_PREPEND_STATIC_BEFORE_SKILLS,
  PLAN_AGENT_SYSTEM_PREPEND_STATIC_AFTER_SKILLS,
  buildPlanAgentSkillsSection,
  buildPlanAgentSystemPrepend,
} from "./plan-agent-prompt"
export {
  PLAN_AGENT_NAMES,
  isPlanAgent,
  PLAN_FAMILY_NAMES,
  isPlanFamily,
} from "./plan-agent-identity"
```

## 7. NEW: `src/shared/category-model-requirements.ts`

```typescript
import type { ModelRequirement } from "./model-requirements"

export const CATEGORY_MODEL_REQUIREMENTS: Record<string, ModelRequirement> = {
  "visual-engineering": {
    fallbackChain: [
      {
        providers: ["google", "github-copilot", "opencode"],
        model: "gemini-3.1-pro",
        variant: "high",
      },
      { providers: ["zai-coding-plan", "opencode"], model: "glm-5" },
      {
        providers: ["anthropic", "github-copilot", "opencode"],
        model: "claude-opus-4-6",
        variant: "max",
      },
      { providers: ["opencode-go"], model: "glm-5" },
      { providers: ["kimi-for-coding"], model: "k2p5" },
    ],
  },
  ultrabrain: {
    fallbackChain: [
      // ... full content from original
    ],
  },
  deep: {
    fallbackChain: [
      // ... full content from original
    ],
    requiresModel: "gpt-5.3-codex",
  },
  artistry: {
    fallbackChain: [
      // ... full content from original
    ],
    requiresModel: "gemini-3.1-pro",
  },
  quick: {
    fallbackChain: [
      // ... full content from original
    ],
  },
  "unspecified-low": {
    fallbackChain: [
      // ... full content from original
    ],
  },
  "unspecified-high": {
    fallbackChain: [
      // ... full content from original
    ],
  },
  writing: {
    fallbackChain: [
      // ... full content from original
    ],
  },
}
```

> Note: Each category's `fallbackChain` contains the exact same entries as the original `model-requirements.ts`. Abbreviated here.

## 8. MODIFIED: `src/shared/model-requirements.ts`

**Remove** `CATEGORY_MODEL_REQUIREMENTS` from the file body. **Add** re-export at the end:

```typescript
export type FallbackEntry = {
  providers: string[];
  model: string;
  variant?: string;
};

export type ModelRequirement = {
  fallbackChain: FallbackEntry[];
  variant?: string;
  requiresModel?: string;
  requiresAnyModel?: boolean;
  requiresProvider?: string[];
};

export const AGENT_MODEL_REQUIREMENTS: Record<string, ModelRequirement> = {
  // ... unchanged, full agent entries stay here
};

export { CATEGORY_MODEL_REQUIREMENTS } from "./category-model-requirements"
```

## Summary of Changes

| File | Lines Before | Lines After | Action |
|------|-------------|-------------|--------|
| `constants.ts` | 654 | ~25 | Rewrite as barrel re-export |
| `default-categories.ts` | - | ~15 | **NEW** |
| `category-descriptions.ts` | - | ~12 | **NEW** |
| `category-prompt-appends.ts` | - | ~280 | **NEW** (mostly exempt prompt text) |
| `plan-agent-prompt.ts` | - | ~270 | **NEW** (mostly exempt prompt text) |
| `plan-agent-identity.ts` | - | ~35 | **NEW** |
| `model-requirements.ts` | 311 | ~165 | Remove CATEGORY_MODEL_REQUIREMENTS |
| `category-model-requirements.ts` | - | ~150 | **NEW** |

**Zero consumer files modified.** Backward compatibility maintained through barrel re-exports.
