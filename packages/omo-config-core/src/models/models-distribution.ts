import { splitReasoningSuffix } from "../schema/reasoning-vocabulary"

type ModelEntry = string | { readonly model: string }
type ModelsDistribution = "sequential" | "round_robin"

export type ModelDistributor = <T extends ModelEntry>(
  target: string,
  models: readonly T[],
  distribution?: ModelsDistribution,
) => readonly T[]

/** Own one distributor per spawn planner, not per resolution or model retry. */
export function createModelDistributor(): ModelDistributor {
  const cursors = new Map<string, number>()
  return (target, models, distribution) => {
    if (distribution !== "round_robin" || models.length === 0) return models
    const seen = new Set<string>()
    const unique = models.filter((entry) => {
      const model = typeof entry === "string" ? entry : entry.model
      const key = splitReasoningSuffix(model, { allowMaxSuffix: true }).base
        .replace(/\([^()]+\)\s*$/, "")
        .replace(/\s+[a-z][a-z0-9_-]*$/i, "")
        .trim()
      if (seen.has(key)) return false
      seen.add(key)
      return true
    })
    const start = (cursors.get(target) ?? 0) % unique.length
    cursors.set(target, (start + 1) % unique.length)
    return [...unique.slice(start), ...unique.slice(0, start)]
  }
}
