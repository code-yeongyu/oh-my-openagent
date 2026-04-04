import type { BuildSystemContentInput } from "./types"
import { buildPlanAgentSystemPrepend, isPlanAgent } from "./constants"
import { buildSystemContentWithTokenLimit } from "./token-limiter"

const FREE_OR_LOCAL_PROMPT_TOKEN_LIMIT = 24000
const PLAN_AGENT_PROMPT_BASE = `

Additional requirements for this planning request:
- Answer in English.
- Write the plan in English.
- Plan well for ultrawork execution.
- Include a clear atomic commit strategy.`

const TDD_LINE = "- Use TDD-oriented planning."

function buildPlanAgentPromptAppend(tddEnabled: boolean): string {
  if (tddEnabled) {
    return `${PLAN_AGENT_PROMPT_BASE}
${TDD_LINE}`
  }
  return PLAN_AGENT_PROMPT_BASE
}

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

  const planAgentPrepend = isPlanAgent(agentName)
    ? buildPlanAgentSystemPrepend(availableCategories, availableSkills)
    : ""

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

export function buildTaskPrompt(prompt: string, agentName: string | undefined, tddEnabled?: boolean): string {
  if (!isPlanAgent(agentName)) {
    return prompt
  }

  const effectiveTdd = tddEnabled ?? true
  return `${prompt}${buildPlanAgentPromptAppend(effectiveTdd)}`
}
