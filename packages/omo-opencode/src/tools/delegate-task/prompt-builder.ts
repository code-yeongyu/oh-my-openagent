import type { BuildSystemContentInput } from "./types"
import type { AvailableSkill } from "../../agents/dynamic-agent-prompt-builder"
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

function mergeNativeIntoAvailable(
  skills: AvailableSkill[],
  nativeSkillInfos: { name: string; description: string; location: string }[] | undefined,
): AvailableSkill[] {
  if (!nativeSkillInfos || nativeSkillInfos.length === 0) return skills
  const knownNames = new Set(skills.map((s) => s.name))
  const merged = [...skills]
  for (const native of nativeSkillInfos) {
    if (knownNames.has(native.name)) continue
    merged.push({ name: native.name, description: native.description, location: "user" })
    knownNames.add(native.name)
  }
  return merged
}

function buildAvailableSkillsSection(skills: AvailableSkill[]): string {
  if (skills.length === 0) {
    return ""
  }

  const rows = skills
    .map((s) => `- \`${s.name}\`: ${s.description || s.name}`)
    .join("\n")

  return `<available_skills>
Skills provide specialized instructions. Load via load_skills parameter when delegating tasks.

${rows}
</available_skills>`
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
    nativeSkillInfos,
  } = input

  const effectiveAvailableSkills = mergeNativeIntoAvailable(availableSkills ?? [], nativeSkillInfos)

  const isPlan = isPlanAgent(agentName)
  const planAgentPrepend = isPlan
    ? buildPlanAgentSystemPrepend(availableCategories, effectiveAvailableSkills)
    : ""

  const skillsSection = !isPlan
    ? buildAvailableSkillsSection(effectiveAvailableSkills)
    : ""

  const baseAgentsContext = agentsContext ?? planAgentPrepend
  const effectiveAgentsContext = !isPlan && skillsSection
    ? [baseAgentsContext, skillsSection].filter(Boolean).join("\n\n")
    : baseAgentsContext

  const effectiveMaxPromptTokens = maxPromptTokens
    ?? (usesFreeOrLocalModel(model) ? FREE_OR_LOCAL_PROMPT_TOKEN_LIMIT : undefined)

  return buildSystemContentWithTokenLimit(
    {
      skillContent,
      skillContents,
      categoryPromptAppend,
      agentsContext: effectiveAgentsContext,
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

export function pruneParentContext(prompt: string): string {
  if (!prompt) return prompt

  // 1. Remove long tool output blocks
  let pruned = prompt.replace(
    /=== (glob|grep|bash|read|find|search) output ===[\s\S]*?(=== end \1 ===|=== \w+ output ===|$)/gi,
    "[Tool output truncated for token budget]"
  )

  // 2. Remove standard XML-like tool output tags if they are very long (e.g. > 1000 chars)
  pruned = pruned.replace(
    /<tool_output>([\s\S]*?)<\/tool_output>/gi,
    (match, p1) => {
      if (p1.length > 500) {
        return "<tool_output>[Tool output truncated for token budget]</tool_output>"
      }
      return match
    }
  )

  // 3. Remove long markdown code blocks that look like terminal logs/outputs
  pruned = pruned.replace(
    /```(bash|sh|console|log)\n([\s\S]*?)```/gi,
    (match, lang, content) => {
      if (content.length > 800) {
        return `\`\`\`${lang}\n[Terminal log output truncated for token budget]\n\`\`\``
      }
      return match
    }
  )

  return pruned
}

export function isSimpleOrCheaperModel(model: { providerID: string; modelID: string; variant?: string } | undefined): boolean {
  if (!model) return false
  const lower = model.modelID.toLowerCase()
  return (
    lower.includes("flash") ||
    lower.includes("mini") ||
    lower.includes("lite") ||
    lower.includes("chat") ||
    lower.includes("haiku") ||
    lower.includes("3.5-haiku") ||
    (lower.includes("3.5") && !lower.includes("sonnet")) ||
    lower.includes("k2.6") ||
    lower.includes("m2.7") ||
    lower.includes("m2.5")
  )
}

export function hasExplicitExecutionSteps(prompt: string): boolean {
  const lower = prompt.toLowerCase()
  // Check for numbered lists (e.g. "1. ", "2. ") or step references ("step 1", "step 2") or bullet lists
  const numberedStepRegex = /(?:^|\n)\s*\d+[\.\)]\s+\w+/
  const stepLabelRegex = /step\s*\d+/i
  const instructionRegex = /(?:instruction|execute|todo|run|edit|modify|fix):\s*/i
  
  return (
    numberedStepRegex.test(prompt) ||
    stepLabelRegex.test(lower) ||
    instructionRegex.test(lower) ||
    lower.includes("步骤") ||
    lower.includes("方案") ||
    lower.includes("具体操作")
  )
}

