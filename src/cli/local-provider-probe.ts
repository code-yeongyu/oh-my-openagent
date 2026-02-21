import type { LocalProvider } from "./types"

const LOCAL_PROVIDER_TIMEOUT_MS = 4000

export interface ProbedLocalModel {
  id: string
  name: string
  contextLength?: number
  outputLength?: number
  parameterSize?: string
}

export interface LocalProviderProbeResult {
  provider: LocalProvider
  url: string
  models: ProbedLocalModel[]
  warning?: string
}

interface LocalProviderProbeInput {
  lmstudioUrl?: string
  ollamaUrl?: string
  vllmUrl?: string
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function normalizeBaseUrl(url: string): string {
  return url.trim().replace(/\/+$/, "")
}

function buildOpenAiModelsUrl(url: string): string {
  return `${normalizeBaseUrl(url)}/models`
}

function buildVllmModelsUrl(url: string): string {
  const normalized = normalizeBaseUrl(url)
  return normalized.endsWith("/v1") ? `${normalized}/models` : `${normalized}/v1/models`
}

function buildOllamaTagsUrl(url: string): string {
  const normalized = normalizeBaseUrl(url)
  return normalized.endsWith("/api/tags") ? normalized : `${normalized}/api/tags`
}

function parsePositiveNumber(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value) && value > 0) {
    return Math.floor(value)
  }
  if (typeof value === "string") {
    const numeric = Number.parseInt(value, 10)
    if (Number.isFinite(numeric) && numeric > 0) {
      return numeric
    }
  }
  return undefined
}

function parseKNotation(value: string): number | undefined {
  const match = value.match(/(\d+)\s*k/i)
  if (!match) return undefined
  const amount = Number.parseInt(match[1], 10)
  if (!Number.isFinite(amount) || amount <= 0) return undefined
  return amount * 1024
}

function extractContextLength(rawModel: Record<string, unknown>): number | undefined {
  const contextCandidates = [
    rawModel.context_length,
    rawModel.contextLength,
    rawModel.max_context_length,
    rawModel.context,
    rawModel.maxModelLen,
    rawModel.num_ctx,
  ]

  const details = isRecord(rawModel.details) ? rawModel.details : null
  if (details) {
    contextCandidates.push(details.context_length, details.contextLength, details.num_ctx)
  }

  for (const candidate of contextCandidates) {
    const parsed = parsePositiveNumber(candidate)
    if (parsed) return parsed
  }

  const id = typeof rawModel.id === "string" ? rawModel.id : ""
  return parseKNotation(id)
}

function extractOutputLength(rawModel: Record<string, unknown>): number | undefined {
  const outputCandidates = [
    rawModel.max_output_tokens,
    rawModel.output_length,
    rawModel.max_completion_tokens,
    rawModel.max_tokens,
  ]

  const details = isRecord(rawModel.details) ? rawModel.details : null
  if (details) {
    outputCandidates.push(details.max_output_tokens, details.output_length)
  }

  for (const candidate of outputCandidates) {
    const parsed = parsePositiveNumber(candidate)
    if (parsed) return parsed
  }

  return undefined
}

async function fetchJson(url: string): Promise<{ data?: unknown; warning?: string }> {
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(LOCAL_PROVIDER_TIMEOUT_MS) })
    if (!response.ok) {
      return {
        warning: `Endpoint returned ${response.status}${response.statusText ? ` ${response.statusText}` : ""}`,
      }
    }
    return { data: await response.json() }
  } catch (error) {
    return {
      warning: error instanceof Error ? error.message : String(error),
    }
  }
}

function parseOpenAiCompatibleModels(payload: unknown): ProbedLocalModel[] | null {
  if (!isRecord(payload) || !Array.isArray(payload.data)) {
    return null
  }

  const parsed: ProbedLocalModel[] = []

  for (const item of payload.data) {
    if (!isRecord(item) || typeof item.id !== "string" || item.id.trim().length === 0) {
      continue
    }

    const contextLength = extractContextLength(item)
    const outputLength = extractOutputLength(item)

    parsed.push({
      id: item.id,
      name: typeof item.name === "string" ? item.name : item.id,
      contextLength,
      outputLength,
    })
  }

  return parsed
}

function parseOllamaModels(payload: unknown): ProbedLocalModel[] | null {
  if (!isRecord(payload) || !Array.isArray(payload.models)) {
    return null
  }

  const parsed: ProbedLocalModel[] = []

  for (const item of payload.models) {
    if (!isRecord(item) || typeof item.name !== "string" || item.name.trim().length === 0) {
      continue
    }

    const details = isRecord(item.details) ? item.details : null
    const parameterSize = typeof details?.parameter_size === "string" ? details.parameter_size : undefined

    const contextLength = extractContextLength(item)
    const outputLength = extractOutputLength(item)

    parsed.push({
      id: item.name,
      name: item.name,
      contextLength,
      outputLength,
      parameterSize,
    })
  }

  return parsed
}

async function probeOpenAiCompatibleProvider(
  provider: LocalProvider,
  url: string,
  modelsUrl: string,
): Promise<LocalProviderProbeResult> {
  const result = await fetchJson(modelsUrl)
  if (result.warning) {
    return {
      provider,
      url,
      models: [],
      warning: result.warning,
    }
  }

  const models = parseOpenAiCompatibleModels(result.data)
  if (!models) {
    return {
      provider,
      url,
      models: [],
      warning: "Malformed model list response",
    }
  }

  return {
    provider,
    url,
    models,
  }
}

async function probeOllamaProvider(url: string): Promise<LocalProviderProbeResult> {
  const result = await fetchJson(buildOllamaTagsUrl(url))
  if (result.warning) {
    return {
      provider: "ollama",
      url,
      models: [],
      warning: result.warning,
    }
  }

  const models = parseOllamaModels(result.data)
  if (!models) {
    return {
      provider: "ollama",
      url,
      models: [],
      warning: "Malformed model list response",
    }
  }

  return {
    provider: "ollama",
    url,
    models,
  }
}

export async function probeLocalProviders(input: LocalProviderProbeInput): Promise<LocalProviderProbeResult[]> {
  const probes: Array<Promise<LocalProviderProbeResult>> = []

  if (input.lmstudioUrl) {
    probes.push(probeOpenAiCompatibleProvider("lmstudio", input.lmstudioUrl, buildOpenAiModelsUrl(input.lmstudioUrl)))
  }

  if (input.ollamaUrl) {
    probes.push(probeOllamaProvider(input.ollamaUrl))
  }

  if (input.vllmUrl) {
    probes.push(probeOpenAiCompatibleProvider("vllm", input.vllmUrl, buildVllmModelsUrl(input.vllmUrl)))
  }

  return Promise.all(probes)
}
