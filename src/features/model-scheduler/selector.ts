import { AGENT_MODEL_REQUIREMENTS, CATEGORY_MODEL_REQUIREMENTS, fuzzyMatchModel } from "../../shared"
import type { RoutingEntry, RoutingTargetKind, SchedulerChangeReason } from "./types"

function normalizeKey(value: string): string {
  return value.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "")
}

function findExactModelMatch(candidate: string, availableModels: Set<string>): string | null {
  const lowered = candidate.trim().toLowerCase()
  for (const model of availableModels) {
    if (model.toLowerCase() === lowered) {
      return model
    }
  }
  return null
}

export function isModelHealthy(model: string | null | undefined, availableModels: Set<string>): boolean {
  if (!model) return false
  return findExactModelMatch(model, availableModels) !== null
}

export function resolveHealthyModel(model: string | null | undefined, availableModels: Set<string>): string | null {
  if (!model) return null
  return findExactModelMatch(model, availableModels)
}

export function selectReplacementModel(args: {
  kind: RoutingTargetKind
  key: string
  routingEntry?: RoutingEntry | null
  currentModel: string | null
  availableModels: Set<string>
}): { model: string | null; reason: SchedulerChangeReason } {
  const { kind, key, routingEntry, currentModel, availableModels } = args

  const healthyCurrent = resolveHealthyModel(currentModel, availableModels)
  if (healthyCurrent) {
    return { model: healthyCurrent, reason: "unavailable" }
  }

  for (const fallback of routingEntry?.fallback ?? []) {
    const exactFallback = resolveHealthyModel(fallback, availableModels)
    if (exactFallback) {
      return { model: exactFallback, reason: "existing-fallback" }
    }
  }

  const requirements = kind === "agent"
    ? AGENT_MODEL_REQUIREMENTS[normalizeKey(key)]
    : CATEGORY_MODEL_REQUIREMENTS[normalizeKey(key)]

  if (!requirements) {
    return { model: null, reason: "unavailable" }
  }

  for (const fallbackEntry of requirements.fallbackChain) {
    const match = fuzzyMatchModel(fallbackEntry.model, availableModels, fallbackEntry.providers)
    if (match) {
      return { model: match, reason: "requirements-fallback" }
    }
  }

  return { model: null, reason: "unavailable" }
}

export function buildNextFallbackList(args: {
  currentPrimary: string | null
  selectedPrimary: string | null
  routingEntry?: RoutingEntry | null
  availableModels: Set<string>
}): string[] {
  const candidates = [
    ...(args.routingEntry?.fallback ?? []),
    ...(args.currentPrimary && args.currentPrimary !== args.selectedPrimary ? [args.currentPrimary] : []),
  ]
  const nextFallbacks: string[] = []

  for (const candidate of candidates) {
    const resolved = resolveHealthyModel(candidate, args.availableModels)
    if (!resolved) continue
    if (resolved === args.selectedPrimary) continue
    if (nextFallbacks.includes(resolved)) continue
    nextFallbacks.push(resolved)
  }

  return nextFallbacks
}
