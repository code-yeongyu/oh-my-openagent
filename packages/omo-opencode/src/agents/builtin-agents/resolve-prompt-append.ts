import { resolvePromptAppend } from "./resolve-file-uri"

export type PromptAppendSource = string | string[]

export type ResolveAgentPromptAppendInput = {
  model?: string
  promptAppend?: PromptAppendSource
  promptAppendAlways?: PromptAppendSource
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
  const conditionalSources = modelMatchesKeyword(input.model, input.excludeModelKeywords)
    ? []
    : normalizeSources(input.promptAppend)
  const sources = [...conditionalSources, ...normalizeSources(input.promptAppendAlways)]
  if (sources.length === 0) return undefined

  return sources.map((source) => resolvePromptAppend(source, input.configDir)).join("\n\n")
}
