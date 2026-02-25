import type { BuildSystemContentInput } from "./types"

const CHARACTERS_PER_TOKEN = 4

export function estimateTokenCount(text: string): number {
  if (!text) {
    return 0
  }

  return Math.ceil(text.length / CHARACTERS_PER_TOKEN)
}

export function truncateToTokenBudget(content: string, maxTokens: number): string {
  if (!content || maxTokens <= 0) {
    return ""
  }

  const maxCharacters = maxTokens * CHARACTERS_PER_TOKEN
  if (content.length <= maxCharacters) {
    return content
  }

  return content.slice(0, maxCharacters)
}

function joinSystemParts(parts: string[]): string | undefined {
  const filtered = parts.filter((part) => part.trim().length > 0)
  if (filtered.length === 0) {
    return undefined
  }

  return filtered.join("\n\n")
}

function reduceSegmentToFitBudget(content: string, overflowTokens: number): string {
  if (overflowTokens <= 0 || !content) {
    return content
  }

  const currentTokens = estimateTokenCount(content)
  const nextBudget = Math.max(0, currentTokens - overflowTokens)
  return truncateToTokenBudget(content, nextBudget)
}

export function buildSystemContentWithTokenLimit(
  input: BuildSystemContentInput,
  maxTokens: number | undefined
): string | undefined {
  const skillParts = input.skillContents?.length
    ? [...input.skillContents]
    : input.skillContent
      ? [input.skillContent]
      : []
  const categoryPromptAppend = input.categoryPromptAppend ?? ""
  const agentsContext = input.agentsContext ?? input.planAgentPrepend ?? ""

  if (maxTokens === undefined) {
    return joinSystemParts([agentsContext, ...skillParts, categoryPromptAppend])
  }

  let nextSkills = [...skillParts]
  let nextCategoryPromptAppend = categoryPromptAppend
  let nextAgentsContext = agentsContext

  const buildCurrentContent = (): string | undefined =>
    joinSystemParts([nextAgentsContext, ...nextSkills, nextCategoryPromptAppend])

  let systemContent = buildCurrentContent()
  if (!systemContent) {
    return undefined
  }

  let overflowTokens = estimateTokenCount(systemContent) - maxTokens

  if (overflowTokens > 0) {
    for (let index = 0; index < nextSkills.length && overflowTokens > 0; index += 1) {
      const skill = nextSkills[index]
      const reducedSkill = reduceSegmentToFitBudget(skill, overflowTokens)
      nextSkills[index] = reducedSkill
      systemContent = buildCurrentContent()
      if (!systemContent) {
        return undefined
      }
      overflowTokens = estimateTokenCount(systemContent) - maxTokens
    }

    nextSkills = nextSkills.filter((skill) => skill.trim().length > 0)
    systemContent = buildCurrentContent()
    if (!systemContent) {
      return undefined
    }
    overflowTokens = estimateTokenCount(systemContent) - maxTokens
  }

  if (overflowTokens > 0 && nextCategoryPromptAppend) {
    nextCategoryPromptAppend = reduceSegmentToFitBudget(nextCategoryPromptAppend, overflowTokens)
    systemContent = buildCurrentContent()
    if (!systemContent) {
      return undefined
    }
    overflowTokens = estimateTokenCount(systemContent) - maxTokens
  }

  if (overflowTokens > 0 && nextAgentsContext) {
    nextAgentsContext = reduceSegmentToFitBudget(nextAgentsContext, overflowTokens)
    systemContent = buildCurrentContent()
    if (!systemContent) {
      return undefined
    }
  }

  if (!systemContent) {
    return undefined
  }

  return truncateToTokenBudget(systemContent, maxTokens)
}
