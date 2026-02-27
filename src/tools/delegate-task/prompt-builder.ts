import type { BuildSystemContentInput } from "./types"
import { buildPlanAgentSystemPrepend, isPlanAgent } from "./constants"
import { safeCompress, shouldCompress } from "../../shared/toon-compression"
import { buildSystemContentWithTokenLimit } from "./token-limiter"

const FREE_OR_LOCAL_PROMPT_TOKEN_LIMIT = 24000

function usesFreeOrLocalModel(model: { providerID: string; modelID: string; variant?: string } | undefined): boolean {
  if (!model) {
    return false
  }

  const provider = model.providerID.toLowerCase()
  const modelId = model.modelID.toLowerCase()
  return provider.includes("local")
    || provider === "ollama"
    || provider === "lmstudio"
    || modelId.includes("free")
}

/**
 * Build the system content to inject into the agent prompt.
 * Combines skill content, category prompt append, and plan agent system prepend.
 * Compresses large arrays using TOON format for token efficiency.
 */
export function buildSystemContent(input: BuildSystemContentInput): string | undefined {
  const {
    skillContent,
    skillContents,
    categoryPromptAppend,
    agentsContext,
    maxPromptTokens,
    model,
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
        parts.push(safeCompress(availableCategories, compressionConfig ?? { enabled: false, threshold: 5000 }))
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
        parts.push(safeCompress(availableSkills, compressionConfig ?? { enabled: false, threshold: 5000 }))
        parts.push("```")
      } else if (availableSkills && availableSkills.length > 0) {
        parts.push("")
        parts.push("### AVAILABLE SKILLS")
        parts.push("")
        const skillRows = availableSkills.map(s => `| ${s.name} | ${s.description} |`).join("\n")
        parts.push("| Skill | Description |")
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

  const effectiveMaxPromptTokens = maxPromptTokens
    ?? (usesFreeOrLocalModel(model) ? FREE_OR_LOCAL_PROMPT_TOKEN_LIMIT : undefined)

  return buildSystemContentWithTokenLimit(
    {
      skillContent,
      skillContents,
      categoryPromptAppend,
      agentsContext: agentsContext ?? planAgentPrepend,
      planAgentPrepend,
    },
    effectiveMaxPromptTokens
  )
}
