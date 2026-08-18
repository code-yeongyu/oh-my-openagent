import type { ReflectionModelPricing } from "./model-cost"

export type MemoryLaunchSurface = "reflection" | "dream" | "facts"

export type MemoryWorkloadProfile = {
  readonly inputTokens: number
  readonly cacheReadTokens: number
  readonly outputTokens: number
  readonly turns: number
}

// Measured on real child sessions under ~/.omo/memory/agents, not estimated: reflection/dream
// median input 44,502 + cacheRead 643,584 + output 6,996 across 21 turns (n=7); facts median input
// 9,742 + cacheRead 9,583 + output 184 across 2 turns (n=205).
export const MEMORY_WORKLOAD_PROFILES: Readonly<Record<MemoryLaunchSurface, MemoryWorkloadProfile>> = {
  reflection: { inputTokens: 44_502, cacheReadTokens: 643_584, outputTokens: 6_996, turns: 21 },
  dream: { inputTokens: 44_502, cacheReadTokens: 643_584, outputTokens: 6_996, turns: 21 },
  facts: { inputTokens: 9_742, cacheReadTokens: 9_583, outputTokens: 184, turns: 2 },
}

const INJECTED_PROMPT_TOKENS = 3_800
const PER_TURN_NEW_TOKENS = 500

export type ForkCostInput = {
  readonly pricing: ReflectionModelPricing & { readonly output?: number }
  readonly parentContextTokens: number
  readonly turns: number
  readonly outputTokens: number
  readonly cacheHit: boolean
}

// Fork mode makes the parent conversation the child's prefix. A cached prefix is charged at
// cacheRead on EVERY turn, so cost grows with turn count; only the first turn pays full input
// price when the parent's cache has expired. Billing the prefix once would make fork look
// permanently cheap and is exactly the defect this module exists to avoid.
export function estimateForkCost(input: ForkCostInput): number {
  const { pricing, parentContextTokens, turns, outputTokens, cacheHit } = input
  const cacheRead = pricing.cacheRead ?? pricing.input
  const firstTurn =
    parentContextTokens * (cacheHit ? cacheRead : pricing.input)
    + INJECTED_PROMPT_TOKENS * pricing.input
  let total = firstTurn
  for (let turn = 1; turn < turns; turn += 1) {
    total += (parentContextTokens + INJECTED_PROMPT_TOKENS + PER_TURN_NEW_TOKENS * turn) * cacheRead
  }
  return (total + outputTokens * (pricing.output ?? 0)) / 1_000_000
}

export type QuickCostInput = {
  readonly pricing: ReflectionModelPricing & { readonly output?: number }
  readonly profile: MemoryWorkloadProfile
}

export function estimateQuickCost(input: QuickCostInput): number {
  const { pricing, profile } = input
  const cacheRead = pricing.cacheRead ?? pricing.input
  const tokens =
    profile.inputTokens * pricing.input
    + profile.cacheReadTokens * cacheRead
    + profile.outputTokens * (pricing.output ?? 0)
  return tokens / 1_000_000
}

export type MemoryRouteCandidate = {
  readonly model: string
  readonly thinking?: string
  readonly cost?: ReflectionModelPricing & { readonly output?: number }
}

export type MemoryLaunchRoute = {
  readonly route: "fork" | "quick"
  readonly model: string
  readonly thinking?: string
  readonly reason: "cheaper" | "only_candidate" | "no_pricing" | "surface_excluded" | "unknown_context"
  readonly forkCost?: number
  readonly quickCost?: number
}

export type MemoryLaunchRouteInput = {
  readonly surface: MemoryLaunchSurface
  readonly quick?: MemoryRouteCandidate
  readonly session?: MemoryRouteCandidate
  readonly parentContextTokens?: number
  readonly turns: number
  readonly cacheHit: boolean
}

export function chooseMemoryLaunchRoute(input: MemoryLaunchRouteInput): MemoryLaunchRoute {
  const { surface, quick, session } = input
  if (quick === undefined) {
    if (session === undefined) throw new Error("chooseMemoryLaunchRoute requires a quick candidate")
    return pick("fork", session, "only_candidate")
  }
  if (surface === "facts") return pick("quick", quick, "surface_excluded")
  if (session === undefined) return pick("quick", quick, "only_candidate")
  if (session.cost === undefined) return pick("quick", quick, "no_pricing")
  if (input.parentContextTokens === undefined) return pick("quick", quick, "unknown_context")

  const profile = MEMORY_WORKLOAD_PROFILES[surface]
  const forkCost = estimateForkCost({
    pricing: session.cost,
    parentContextTokens: input.parentContextTokens,
    turns: input.turns,
    outputTokens: profile.outputTokens,
    cacheHit: input.cacheHit,
  })
  const quickCost = quick.cost === undefined
    ? undefined
    : estimateQuickCost({ pricing: quick.cost, profile })
  if (quickCost === undefined) return pick("quick", quick, "no_pricing")
  if (forkCost < quickCost) {
    return { ...pick("fork", session, "cheaper"), forkCost, quickCost }
  }
  return { ...pick("quick", quick, "cheaper"), forkCost, quickCost }
}

function pick(
  route: "fork" | "quick",
  candidate: MemoryRouteCandidate,
  reason: MemoryLaunchRoute["reason"],
): MemoryLaunchRoute {
  return {
    route,
    model: candidate.model,
    ...(candidate.thinking === undefined ? {} : { thinking: candidate.thinking }),
    reason,
  }
}
