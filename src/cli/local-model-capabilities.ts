import type { LocalProvider, LocalProviderModels, LocalModelConfig, LocalModelTarget } from "./types"
import type { LocalProviderProbeResult, ProbedLocalModel } from "./local-provider-probe"

const LOCAL_SELECTOR_PREFIX = "local:"

const LOCAL_MODEL_TARGETS: LocalModelTarget[] = [
  "explore",
  "librarian",
  "atlas",
  "multimodal-looker",
  "quick",
  "unspecified-low",
]

const DEFAULT_OUTPUT_TOKENS = 4096

function parseKNotation(value: string): number | undefined {
  const match = value.match(/(\d+)\s*k/i)
  if (!match) return undefined

  const amount = Number.parseInt(match[1], 10)
  if (!Number.isFinite(amount) || amount <= 0) return undefined

  return amount * 1024
}

function estimateContextLength(model: ProbedLocalModel): number | undefined {
  if (typeof model.contextLength === "number" && Number.isFinite(model.contextLength) && model.contextLength > 0) {
    return Math.floor(model.contextLength)
  }

  return parseKNotation(model.id) ?? parseKNotation(model.name)
}

function estimateOutputLength(model: ProbedLocalModel, contextLength?: number): number {
  if (typeof model.outputLength === "number" && Number.isFinite(model.outputLength) && model.outputLength > 0) {
    return Math.floor(model.outputLength)
  }

  if (contextLength) {
    return Math.max(2048, Math.min(8192, Math.floor(contextLength / 8)))
  }

  return DEFAULT_OUTPUT_TOKENS
}

function detectCapabilities(model: ProbedLocalModel): {
  capabilities: LocalModelConfig["capabilities"]
  targets: LocalModelConfig["targets"]
} {
  const name = `${model.id} ${model.name}`.toLowerCase()

  if (name.includes("devstral")) {
    return {
      capabilities: ["multimodal", "coding", "general"],
      targets: ["explore", "librarian", "atlas", "multimodal-looker", "quick", "unspecified-low"],
    }
  }

  if (name.includes("codestral") || name.includes("qwen") || name.includes("deepseek")) {
    return {
      capabilities: ["coding", "general"],
      targets: ["explore", "librarian", "atlas", "quick", "unspecified-low"],
    }
  }

  if (name.includes("llama") || name.includes("mistral")) {
    return {
      capabilities: ["general"],
      targets: ["explore", "atlas", "quick", "unspecified-low"],
    }
  }

  return {
    capabilities: ["general"],
    targets: ["explore"],
  }
}

function capabilityRank(model: LocalModelConfig): number {
  if (model.capabilities.includes("multimodal")) return 3
  if (model.capabilities.includes("coding")) return 2
  if (model.targets.length > 1) return 1
  return 0
}

function sortByUsefulness(models: LocalModelConfig[]): LocalModelConfig[] {
  return [...models].sort((a, b) => {
    const rankDiff = capabilityRank(b) - capabilityRank(a)
    if (rankDiff !== 0) return rankDiff

    const contextDiff = (b.contextLength ?? 0) - (a.contextLength ?? 0)
    if (contextDiff !== 0) return contextDiff

    return a.id.localeCompare(b.id)
  })
}

export function createEmptyLocalProviderModels(): LocalProviderModels {
  return {
    lmstudio: [],
    ollama: [],
    vllm: [],
  }
}

function mapProbeModel(model: ProbedLocalModel): LocalModelConfig {
  const contextLength = estimateContextLength(model)
  const outputLength = estimateOutputLength(model, contextLength)
  const { capabilities, targets } = detectCapabilities(model)

  return {
    id: model.id,
    name: model.name,
    contextLength,
    outputLength,
    capabilities,
    targets,
  }
}

function dedupeById(models: LocalModelConfig[]): LocalModelConfig[] {
  const deduped = new Map<string, LocalModelConfig>()
  for (const model of models) {
    if (!deduped.has(model.id)) {
      deduped.set(model.id, model)
    }
  }
  return [...deduped.values()]
}

export function mapProbeResultsToLocalProviderModels(results: LocalProviderProbeResult[]): LocalProviderModels {
  const mapped = createEmptyLocalProviderModels()

  for (const result of results) {
    const converted = dedupeById(result.models.map(mapProbeModel))
    mapped[result.provider] = sortByUsefulness(converted)
  }

  return mapped
}

export function toLocalModelSelector(target: LocalModelTarget): string {
  return `${LOCAL_SELECTOR_PREFIX}${target}`
}

export function isLocalModelSelector(model: string): boolean {
  return model.startsWith(LOCAL_SELECTOR_PREFIX)
}

function isLocalTarget(value: string): value is LocalModelTarget {
  return LOCAL_MODEL_TARGETS.includes(value as LocalModelTarget)
}

export function resolveLocalModelForSelector(
  provider: LocalProvider,
  selector: string,
  localProviderModels: LocalProviderModels,
): string | null {
  if (!isLocalModelSelector(selector)) {
    return selector
  }

  const target = selector.slice(LOCAL_SELECTOR_PREFIX.length)
  if (!isLocalTarget(target)) {
    return null
  }

  const matched = localProviderModels[provider].find((model) => model.targets.includes(target))
  return matched?.id ?? null
}

export function getDiscoveredModelNames(result: LocalProviderProbeResult): string[] {
  return result.models.map((model) => model.id)
}
