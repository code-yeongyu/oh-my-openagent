import type { ReflectionModelPricing } from "./model-cost"

export type RegistryFallbackCandidate = {
  readonly model: string
  readonly cost?: ReflectionModelPricing
}

const NON_CHAT_ID = /embed|image|audio|tts|whisper|rerank|moderation/i
const FAST_TIER_ID = /fast|flash|mini|lite|haiku|turbo|highspeed/i
const MIN_CONTEXT_WINDOW = 65_536
const MAX_CANDIDATES = 3

type RegistryCandidate = {
  readonly provider: string
  readonly id: string
  readonly inputCost: number | undefined
  readonly cost: ReflectionModelPricing | undefined
  readonly contextWindow: number | undefined
  readonly order: number
}

export function selectRegistryFallbackModels(available: unknown): readonly RegistryFallbackCandidate[] {
  if (!Array.isArray(available)) return []
  const candidates = available
    .map(parseCandidate)
    .filter((candidate): candidate is RegistryCandidate => candidate !== undefined)
    .filter((candidate) => !NON_CHAT_ID.test(candidate.id))
    .filter((candidate) => candidate.contextWindow === undefined || candidate.contextWindow >= MIN_CONTEXT_WINDOW)
  candidates.sort(compareCandidates)
  return candidates.slice(0, MAX_CANDIDATES).map((candidate) => ({
    model: `${candidate.provider}/${candidate.id}`,
    ...(candidate.cost === undefined ? {} : { cost: candidate.cost }),
  }))
}

export function readModelPricing(entry: unknown): ReflectionModelPricing | undefined {
  if (!isRecord(entry) || !isRecord(entry.cost)) return undefined
  const input = entry.cost.input
  if (typeof input !== "number") return undefined
  const cacheRead = entry.cost.cacheRead
  return { input, ...(typeof cacheRead === "number" ? { cacheRead } : {}) }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
}

function parseCandidate(entry: unknown, order: number): RegistryCandidate | undefined {
  if (!isRecord(entry)) return undefined
  const provider = entry.provider
  const id = entry.id
  if (typeof provider !== "string" || provider.length === 0) return undefined
  if (typeof id !== "string" || id.length === 0) return undefined
  const cost = readModelPricing(entry)
  const contextWindow = typeof entry.contextWindow === "number" ? entry.contextWindow : undefined
  return { provider, id, inputCost: cost?.input, cost, contextWindow, order }
}

// Cheapest priced model first; unpriced models rank after every priced one, fast-tier names
// leading among them, so a registry without models.dev cost data still yields a sane pick.
function compareCandidates(left: RegistryCandidate, right: RegistryCandidate): number {
  if (left.inputCost !== undefined && right.inputCost !== undefined) {
    if (left.inputCost !== right.inputCost) return left.inputCost - right.inputCost
    const contextDelta = (right.contextWindow ?? 0) - (left.contextWindow ?? 0)
    if (contextDelta !== 0) return contextDelta
    return left.order - right.order
  }
  if (left.inputCost !== undefined) return -1
  if (right.inputCost !== undefined) return 1
  const leftFast = FAST_TIER_ID.test(left.id)
  const rightFast = FAST_TIER_ID.test(right.id)
  if (leftFast !== rightFast) return leftFast ? -1 : 1
  return left.order - right.order
}
