import {
  AGENT_MODEL_REQUIREMENTS,
  CATEGORY_MODEL_REQUIREMENTS,
  fuzzyMatchModel,
} from "../../shared"
import type { RoutingEntry, RoutingTargetKind } from "./types"

function normalizeKey(value: string): string {
  return value.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "")
}

function resolveCandidate(model: string | null | undefined, availableModels: Set<string>): string[] {
  if (!model) return []

  for (const availableModel of availableModels) {
    if (availableModel.toLowerCase() === model.trim().toLowerCase()) {
      return [availableModel]
    }
  }

  return []
}

export function collectCandidateModels(args: {
  kind: RoutingTargetKind
  key: string
  routingEntry?: RoutingEntry | null
  currentModel: string | null
  availableModels: Set<string>
}): string[] {
  const resolvedCandidates = new Set<string>()
  const pushResolved = (model: string | null | undefined) => {
    for (const resolved of resolveCandidate(model, args.availableModels)) {
      resolvedCandidates.add(resolved)
    }
  }

  pushResolved(args.currentModel)
  for (const fallback of args.routingEntry?.fallback ?? []) {
    pushResolved(fallback)
  }

  const requirements = args.kind === "agent"
    ? AGENT_MODEL_REQUIREMENTS[normalizeKey(args.key)]
    : CATEGORY_MODEL_REQUIREMENTS[normalizeKey(args.key)]

  for (const fallbackEntry of requirements?.fallbackChain ?? []) {
    const matchedModel = fuzzyMatchModel(
      fallbackEntry.model,
      args.availableModels,
      fallbackEntry.providers,
    )
    if (matchedModel) {
      resolvedCandidates.add(matchedModel)
    }
  }

  return Array.from(resolvedCandidates)
}
