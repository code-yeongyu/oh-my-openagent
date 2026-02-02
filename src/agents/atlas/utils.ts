/**
 * Atlas Orchestrator - Shared Utilities
 *
 * Common functions for building dynamic prompt sections used by both
 * default (Claude-optimized) and GPT-optimized prompts.
 */

import type { CategoryConfig } from "../../config/schema"
import type { AvailableAgent, AvailableSkill } from "../dynamic-agent-prompt-builder"
import { DEFAULT_CATEGORIES, CATEGORY_DESCRIPTIONS } from "../../tools/delegate-task/constants"

export const getCategoryDescription = (name: string, userCategories?: Record<string, CategoryConfig>) =>
  userCategories?.[name]?.description ?? CATEGORY_DESCRIPTIONS[name] ?? "General tasks"

export function buildAgentSelectionSection(agents: AvailableAgent[]): string {
  if (agents.length === 0) {
    return `##### Option B: Use AGENT directly (for specialized experts)

No agents available.`
  }

  const rows = agents.map((a) => {
    const shortDesc = a.description.split(".")[0] || a.description
    return `| \`${a.name}\` | ${shortDesc} |`
  })

  return `##### Option B: Use AGENT directly (for specialized experts)

| Agent | Best For |
|-------|----------|
${rows.join("\n")}`
}

export function buildCategorySection(userCategories?: Record<string, CategoryConfig>): string {
  const allCategories = { ...DEFAULT_CATEGORIES, ...userCategories }
  const categoryRows = Object.entries(allCategories).map(([name, config]) => {
    const temp = config.temperature ?? 0.5
    return `| \`${name}\` | ${temp} | ${getCategoryDescription(name, userCategories)} |`
  })

  return `##### Option A: Use CATEGORY (for domain-specific work)

Categories spawn \`Sisyphus-Junior-{category}\` with optimized settings:

| Category | Temperature | Best For |
|----------|-------------|----------|
${categoryRows.join("\n")}

\`\`\`typescript
delegate_task(category="[category-name]", load_skills=[...], prompt="...")
\`\`\``
}

export function buildSkillsSection(skills: AvailableSkill[]): string {
  if (skills.length === 0) {
    return ""
  }

  const skillRows = skills.map((s) => {
    const shortDesc = s.description.split(".")[0] || s.description
    return `| \`${s.name}\` | ${shortDesc} |`
  })

  return `
#### 3.2.2: Skill Selection (PREPEND TO PROMPT)

**Skills are specialized instructions that guide subagent behavior. Consider them alongside category selection.**

| Skill | When to Use |
|-------|-------------|
${skillRows.join("\n")}

**MANDATORY: Evaluate ALL skills for relevance to your task.**

Read each skill's description and ask: "Does this skill's domain overlap with my task?"
- If YES: INCLUDE in load_skills=[...]
- If NO: You MUST justify why in your pre-delegation declaration

**Usage:**
\`\`\`typescript
delegate_task(category="[category]", load_skills=["skill-1", "skill-2"], prompt="...")
\`\`\`

**IMPORTANT:**
- Skills get prepended to the subagent's prompt, providing domain-specific instructions
- Subagents are STATELESS - they don't know what skills exist unless you include them
- Missing a relevant skill = suboptimal output quality`
}

export function buildDecisionMatrix(agents: AvailableAgent[], userCategories?: Record<string, CategoryConfig>): string {
  const allCategories = { ...DEFAULT_CATEGORIES, ...userCategories }

  const categoryRows = Object.entries(allCategories).map(([name]) =>
    `| ${getCategoryDescription(name, userCategories)} | \`category="${name}", load_skills=[...]\` |`
  )

  const agentRows = agents.map((a) => {
    const shortDesc = a.description.split(".")[0] || a.description
    return `| ${shortDesc} | \`agent="${a.name}"\` |`
  })

  return `##### Decision Matrix

| Task Domain | Use |
|-------------|-----|
${categoryRows.join("\n")}
${agentRows.join("\n")}

**NEVER provide both category AND agent - they are mutually exclusive.**`
}
