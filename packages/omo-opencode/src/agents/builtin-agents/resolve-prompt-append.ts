import { resolvePromptAppend } from "./resolve-file-uri"

export type PromptAppendSource = string | string[]

export type ResolveAgentPromptAppendInput = {
  model?: string
  promptAppend?: PromptAppendSource
  promptAppendAlways?: PromptAppendSource
  includeModelKeywords?: string[]
  excludeModelKeywords?: string[]
  configDir?: string
}

function normalizeSources(source: PromptAppendSource | undefined): string[] {
  if (source === undefined) return []
  return (Array.isArray(source) ? source : [source]).filter((item) => item.length > 0)
}

function modelMatchesKeyword(model: string | undefined, keywords: string[] | undefined): boolean {
  if (!model || !keywords?.length) return false

  const separatorIndex = model.indexOf("/")
  const modelId = (separatorIndex === -1 ? model : model.slice(separatorIndex + 1)).toLowerCase()
  return keywords.some((keyword) => {
    const normalizedKeyword = keyword.trim().toLowerCase()
    return normalizedKeyword.length > 0 && modelId.includes(normalizedKeyword)
  })
}

export function resolveAgentPromptAppend(input: ResolveAgentPromptAppendInput): string | undefined {
  const hasIncludeKeywords = input.includeModelKeywords?.some((keyword) => keyword.trim().length > 0) ?? false
  const includeMatches = !hasIncludeKeywords || modelMatchesKeyword(input.model, input.includeModelKeywords)
  const excludeMatches = modelMatchesKeyword(input.model, input.excludeModelKeywords)
  const conditionalSources = includeMatches && !excludeMatches ? normalizeSources(input.promptAppend) : []
  const sources = [...conditionalSources, ...normalizeSources(input.promptAppendAlways)]
  if (sources.length === 0) return undefined

  return sources.map((source) => resolvePromptAppend(source, input.configDir)).join("\n\n")
}
