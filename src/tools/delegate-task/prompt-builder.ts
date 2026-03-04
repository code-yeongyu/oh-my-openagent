import type { BuildSystemContentInput } from "./types"
import { buildPlanAgentSystemPrepend, isPlanAgent, PLAN_AGENT_SYSTEM_PREPEND_STATIC_BEFORE_SKILLS, PLAN_AGENT_SYSTEM_PREPEND_STATIC_AFTER_SKILLS, buildPlanAgentSkillsSection } from "./constants"
import { safeCompress, shouldCompress } from "../../shared/toon-compression"
import { getGlobalCompressionConfig } from "../../shared/toon-compression/config-store"
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
  } = input

  const compressionConfig = getGlobalCompressionConfig()
  const threshold = compressionConfig?.threshold ?? 5000

  // Check if arrays should be compressed
  const shouldCompressCategories = availableCategories && shouldCompress(availableCategories, threshold)
  const shouldCompressSkills = availableSkills && shouldCompress(availableSkills, threshold)

  let planAgentPrepend: string

  if (isPlanAgent(agentName)) {
    if (compressionConfig?.enabled && (shouldCompressCategories || shouldCompressSkills)) {
      // Build compressed version of plan agent prepend with ALL mandatory sections
      // Strategy: Use static sections, but replace skills section with TOON-formatted version
      const parts: string[] = []
      parts.push(PLAN_AGENT_SYSTEM_PREPEND_STATIC_BEFORE_SKILLS)

      // Build skills section - use TOON format for compressed arrays
      if (shouldCompressCategories && availableCategories && shouldCompressSkills && availableSkills) {
        // Both compressed - build TOON skills section
        parts.push("")
        parts.push("### AVAILABLE CATEGORIES (TOON format)")
        parts.push("\n```toon")
        parts.push(safeCompress(availableCategories, "delegate-prompt-builder"))
        parts.push("```")
        parts.push("")
        parts.push("### AVAILABLE SKILLS (TOON format)")
        parts.push("\n```toon")
        parts.push(safeCompress(availableSkills, "delegate-prompt-builder"))
        parts.push("```")
      } else if (shouldCompressCategories && availableCategories) {
        // Only categories compressed
        parts.push("")
        parts.push("### AVAILABLE CATEGORIES (TOON format)")
        parts.push("\n```toon")
        parts.push(safeCompress(availableCategories, "delegate-prompt-builder"))
        parts.push("```")
        parts.push("")
        // Skills uncompressed - use standard rendering
        if (availableSkills && availableSkills.length > 0) {
          const skillRows = availableSkills.map(s => `| \`${s.name}\` | ${s.description} |`).join("\n")
          parts.push("### AVAILABLE SKILLS (ALWAYS EVALUATE ALL)")
          parts.push("")
          parts.push("Skills inject specialized expertise into the delegated agent.")
          parts.push("YOU MUST evaluate EVERY skill and justify inclusions/omissions.")
          parts.push("")
          parts.push("| Skill | Domain |")
          parts.push("|-------|--------|")
          parts.push(skillRows)
        }
      } else if (shouldCompressSkills && availableSkills) {
        // Only skills compressed - categories use standard rendering
        if (availableCategories && availableCategories.length > 0) {
          const categoryRows = availableCategories.map(c => `| \`${c.name}\` | ${c.description || c.name} | ${c.model || ""} |`).join("\n")
          parts.push("")
          parts.push("### AVAILABLE CATEGORIES")
          parts.push("")
          parts.push("| Category | Best For | Model |")
          parts.push("|----------|----------|-------|")
          parts.push(categoryRows)
        }
        parts.push("")
        parts.push("### AVAILABLE SKILLS (TOON format)")
        parts.push("\n```toon")
        parts.push(safeCompress(availableSkills, "delegate-prompt-builder"))
        parts.push("```")
      } else {
        // Fallback: use standard skills section (shouldn't reach here given condition)
        parts.push(buildPlanAgentSkillsSection(availableCategories, availableSkills))
      }

      parts.push("")
      parts.push(PLAN_AGENT_SYSTEM_PREPEND_STATIC_AFTER_SKILLS)
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
