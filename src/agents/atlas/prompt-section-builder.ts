/**
 * Atlas Orchestrator - Shared Utilities
 *
 * Common functions for building dynamic prompt sections used by both
 * default (Claude-optimized) and GPT-optimized prompts.
 */

import type { CategoryConfig } from "../../config/schema"
import { formatCustomSkillsBlock, type AvailableAgent, type AvailableSkill } from "../dynamic-agent-prompt-builder"
import { CATEGORY_DESCRIPTIONS } from "../../tools/delegate-task/constants"
import { mergeCategories } from "../../shared/merge-categories"
import { truncateDescription } from "../../shared/truncate-description"

export const getCategoryDescription = (name: string, userCategories?: Record<string, CategoryConfig>) =>
  userCategories?.[name]?.description ?? CATEGORY_DESCRIPTIONS[name] ?? "General tasks"

export function buildAgentSelectionSection(agents: AvailableAgent[]): string {
   if (agents.length === 0) {
     return `##### Option B: Use AGENT directly (for specialized experts)

 No agents available.`
   }

   const rows = agents.map((a) => {
     const shortDesc = truncateDescription(a.description)
     return `- **\`${a.name}\`** — ${shortDesc}`
   })

  return `##### Option B: Use AGENT directly (for specialized experts)

${rows.join("\n")}`
}

export function buildCategorySection(userCategories?: Record<string, CategoryConfig>): string {
  const allCategories = mergeCategories(userCategories)
  const categoryRows = Object.entries(allCategories).map(([name, config]) => {
    const temp = config.temperature ?? 0.5
    const desc = getCategoryDescription(name, userCategories)
    return `- **\`${name}\`** (${temp}): ${desc}`
  })

  return `##### Option A: Use CATEGORY (for domain-specific work)

Categories spawn \`Sisyphus-Junior-{category}\` with optimized settings:

${categoryRows.join("\n")}

\`\`\`typescript
task(category="[category-name]", load_skills=[...], run_in_background=false, prompt="...")
\`\`\``
}

export function buildSkillsSection(skills: AvailableSkill[]): string {
  if (skills.length === 0) {
    return ""
  }

  const builtinSkills = skills.filter((s) => s.location === "plugin")
  const customSkills = skills.filter((s) => s.location !== "plugin")

   const builtinRows = builtinSkills.map((s) => {
     const shortDesc = truncateDescription(s.description)
     return `- **\`${s.name}\`** — ${shortDesc}`
   })

   const customRows = customSkills.map((s) => {
     const shortDesc = truncateDescription(s.description)
     const source = s.location === "project" ? "project" : "user"
     return `- **\`${s.name}\`** (${source}): ${shortDesc}`
   })

  const customSkillBlock = formatCustomSkillsBlock(customRows, customSkills, "**")

  let skillsTable: string

  if (customSkills.length > 0 && builtinSkills.length > 0) {
    skillsTable = `**Built-in Skills:**

${builtinRows.join("\n")}

${customSkillBlock}`
  } else if (customSkills.length > 0) {
    skillsTable = customSkillBlock
  } else {
    skillsTable = `${builtinRows.join("\n")}`
  }

  return `
#### 3.2.2: Skill Selection (PREPEND TO PROMPT)

**Skills are specialized instructions that guide subagent behavior. Consider them alongside category selection.**

${skillsTable}

**MANDATORY: Evaluate ALL skills (built-in AND user-installed) for relevance to your task.**

Read each skill's description and ask: "Does this skill's domain overlap with my task?"
- If YES: INCLUDE in load_skills=[...]
- If NO: You MUST justify why in your pre-delegation declaration

**Usage:**
\`\`\`typescript
task(category="[category]", load_skills=["skill-1", "skill-2"], run_in_background=false, prompt="...")
\`\`\`

**IMPORTANT:**
- Skills get prepended to the subagent's prompt, providing domain-specific instructions
- Subagents are STATELESS - they don't know what skills exist unless you include them
- Missing a relevant skill = suboptimal output quality`
}

export function buildDecisionMatrix(agents: AvailableAgent[], userCategories?: Record<string, CategoryConfig>): string {
  const allCategories = mergeCategories(userCategories)

  const categoryRows = Object.entries(allCategories).map(([name]) => {
    const desc = getCategoryDescription(name, userCategories)
    return `- **${desc}**: \`category="${name}", load_skills=[...]\``
  })

   const agentRows = agents.map((a) => {
     const shortDesc = truncateDescription(a.description)
     return `- **${shortDesc}**: \`agent="${a.name}"\``
   })

  return `##### Decision Matrix

${categoryRows.join("\n")}
${agentRows.join("\n")}

**NEVER provide both category AND agent - they are mutually exclusive.**`
}
