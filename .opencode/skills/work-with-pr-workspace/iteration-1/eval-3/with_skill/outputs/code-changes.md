# Code Changes

## New File: `src/tools/delegate-task/default-categories.ts`

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

## New File: `src/tools/delegate-task/category-prompt-appends.ts`

```typescript
export const VISUAL_CATEGORY_PROMPT_APPEND = `<Category_Context>
You are working on VISUAL/UI tasks.
...
</Category_Context>`
// (exact content from lines 8-95 of constants.ts)

export const ULTRABRAIN_CATEGORY_PROMPT_APPEND = `<Category_Context>
...
</Category_Context>`
// (exact content from lines 97-117)

export const ARTISTRY_CATEGORY_PROMPT_APPEND = `<Category_Context>
...
</Category_Context>`
// (exact content from lines 119-134)

export const QUICK_CATEGORY_PROMPT_APPEND = `<Category_Context>
...
</Caller_Warning>`
// (exact content from lines 136-186)

export const UNSPECIFIED_LOW_CATEGORY_PROMPT_APPEND = `<Category_Context>
...
</Caller_Warning>`
// (exact content from lines 188-209)

export const UNSPECIFIED_HIGH_CATEGORY_PROMPT_APPEND = `<Category_Context>
...
</Category_Context>`
// (exact content from lines 211-224)

export const WRITING_CATEGORY_PROMPT_APPEND = `<Category_Context>
...
</Category_Context>`
// (exact content from lines 226-250)

export const DEEP_CATEGORY_PROMPT_APPEND = `<Category_Context>
...
</Category_Context>`
// (exact content from lines 252-281)

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

## New File: `src/tools/delegate-task/plan-agent-prompt.ts`

```typescript
import type {
  AvailableCategory,
  AvailableSkill,
} from "../../agents/dynamic-agent-prompt-builder"
import { truncateDescription } from "../../shared/truncate-description"

/**
 * System prompt prepended to plan agent invocations.
 * Instructs the plan agent to first gather context via explore/librarian agents,
 * then summarize user requirements and clarify uncertainties before proceeding.
 * Also MANDATES dependency graphs, parallel execution analysis, and category+skill recommendations.
 */
export const PLAN_AGENT_SYSTEM_PREPEND_STATIC_BEFORE_SKILLS = `<system>
...
</CRITICAL_REQUIREMENT_DEPENDENCY_PARALLEL_EXECUTION_CATEGORY_SKILLS>
`
// (exact content from lines 324-430)

export const PLAN_AGENT_SYSTEM_PREPEND_STATIC_AFTER_SKILLS = `### REQUIRED OUTPUT FORMAT
...
`
// (exact content from lines 432-569)

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

## New File: `src/tools/delegate-task/plan-agent-names.ts`

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

## Modified File: `src/tools/delegate-task/constants.ts`

```typescript
export * from "./default-categories"
export * from "./category-prompt-appends"
export * from "./plan-agent-prompt"
export * from "./plan-agent-names"
```

## Unchanged: `src/tools/delegate-task/index.ts`

```typescript
export { createDelegateTask, resolveCategoryConfig, buildSystemContent, buildTaskPrompt } from "./tools"
export type { DelegateTaskToolOptions, SyncSessionCreatedEvent, BuildSystemContentInput } from "./tools"
export type * from "./types"
export * from "./constants"
```

No changes needed. `export * from "./constants"` transitively re-exports everything from the 4 new files.
