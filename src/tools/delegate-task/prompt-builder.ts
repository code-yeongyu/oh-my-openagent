import type { BuildSystemContentInput } from "./types"
import { buildPlanAgentSystemPrepend, isPlanAgent } from "./constants"
import { safeCompress, shouldCompress } from "../../shared/toon-compression"

/**
 * Build the system content to inject into the agent prompt.
 * Combines skill content, category prompt append, and plan agent system prepend.
 * Compresses large arrays using TOON format for token efficiency.
 */
export function buildSystemContent(input: BuildSystemContentInput): string | undefined {
  const {
    skillContent,
    categoryPromptAppend,
    agentName,
    availableCategories,
    availableSkills,
    compressionConfig,
  } = input

  const threshold = compressionConfig?.threshold ?? 5000

  // Check if arrays should be compressed
  const shouldCompressCategories = availableCategories && shouldCompress(availableCategories, threshold)
  const shouldCompressSkills = availableSkills && shouldCompress(availableSkills, threshold)

  let planAgentPrepend: string

  if (isPlanAgent(agentName)) {
    if (shouldCompressCategories || shouldCompressSkills) {
      // Build compressed version of plan agent prepend
      const parts: string[] = ["<system>"]
      parts.push("## MANDATORY CONTEXT GATHERING PROTOCOL")
      parts.push("")
      parts.push("Before planning, gather context using the task tool with explore/librarian agents.")
      parts.push("")

      if (shouldCompressCategories && availableCategories) {
        parts.push("### AVAILABLE CATEGORIES (TOON format)")
        parts.push("```toon")
        parts.push(safeCompress(availableCategories, compressionConfig!))
        parts.push("```")
      } else if (availableCategories && availableCategories.length > 0) {
        parts.push("### AVAILABLE CATEGORIES")
        parts.push("")
        const categoryRows = availableCategories.map(c => `| ${c.name} | ${c.description} |`).join("\n")
        parts.push("| Category | Description |")
        parts.push("|----------|-------------|")
        parts.push(categoryRows)
      }

      if (shouldCompressSkills && availableSkills) {
        parts.push("")
        parts.push("### AVAILABLE SKILLS (TOON format)")
        parts.push("```toon")
        parts.push(safeCompress(availableSkills, compressionConfig!))
        parts.push("```")
      } else if (availableSkills && availableSkills.length > 0) {
        parts.push("")
        parts.push("### AVAILABLE SKILLS")
        parts.push("")
        const skillRows = availableSkills.map(s => `| ${s.name} | ${s.description} |`).join("\n")
        parts.push("| Skill | Domain |")
        parts.push("|-------|--------|")
        parts.push(skillRows)
      }

      parts.push("")
      parts.push("</system>")
      planAgentPrepend = parts.join("\n")
    } else {
      planAgentPrepend = buildPlanAgentSystemPrepend(availableCategories, availableSkills)
    }
  } else {
    planAgentPrepend = ""
  }

  if (!skillContent && !categoryPromptAppend && !planAgentPrepend) {
    return undefined
  }

  const parts: string[] = []

  if (planAgentPrepend) {
    parts.push(planAgentPrepend)
  }

  if (skillContent) {
    parts.push(skillContent)
  }

  if (categoryPromptAppend) {
    parts.push(categoryPromptAppend)
  }

  return parts.join("\n\n") || undefined
}
