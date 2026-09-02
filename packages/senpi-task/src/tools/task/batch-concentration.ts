import type { ResolvedModelRecord } from "../../state"
import type { ResolvedSpawnItem } from "./types"

// Issue #6917 guardrail: a wave that routes many same-category tasks to one provider model
// amplifies quota exhaustion (429 FreeUsageLimitError) into mid-wave detach storms. The batch
// spawn path reports the concentration instead of staying silent.

export const PROVIDER_CONCENTRATION_THRESHOLD = 4

export type ConcentrationObservation = {
  readonly category?: string
  readonly resolvedModel?: ResolvedModelRecord
}

export function observeStartedItem(
  item: ResolvedSpawnItem,
  resolvedModel: ResolvedModelRecord | undefined,
): ConcentrationObservation | undefined {
  if (item.kind !== "category" || resolvedModel === undefined) return undefined
  return { category: item.category, resolvedModel }
}

export function lintProviderConcentration(
  observations: readonly ConcentrationObservation[],
): string | undefined {
  const groups = new Map<string, { count: number; category: string; modelId: string }>()
  for (const observation of observations) {
    const category = observation.category
    const model = observation.resolvedModel
    if (category === undefined || model === undefined) continue
    const key = `${category}|${model.provider}/${model.model_id}`
    const group = groups.get(key) ?? { count: 0, category, modelId: `${model.provider}/${model.model_id}` }
    group.count += 1
    groups.set(key, group)
  }
  for (const group of groups.values()) {
    if (group.count < PROVIDER_CONCENTRATION_THRESHOLD) continue
    return [
      `Provider concentration warning: ${group.count} tasks share category "${group.category}" on ${group.modelId}.`,
      "Concurrent identical-model workers amplify provider quota exhaustion (429 FreeUsageLimitError) and mid-wave detach storms.",
      "Disperse later waves across alternate categories or models, or split large tasks into smaller subtasks.",
    ].join(" ")
  }
  return undefined
}
