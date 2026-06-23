import type { AttributionCriteria, CausalRelation, ConsequenceEdge, LiftStrength } from "./types"

const VULNERABLE_TERMS = ["vulnerable", "pregnant", "neonat", "dialysis", "renal", "elderly"]

function pointsForCriteria(criteria: AttributionCriteria): number {
  let points = 0
  points += criteria.directness === "direct" ? 3 : criteria.directness === "mediated" ? 1 : 0
  points += criteria.foreseeability === "high" ? 2 : criteria.foreseeability === "medium" ? 1 : 0
  points += criteria.controllability === "high" ? 2 : criteria.controllability === "partial" ? 1 : 0
  points += criteria.affectsVulnerable ? 1 : 0
  points += criteria.horizon === "immediate" ? 1 : criteria.horizon === "medium" ? -1 : 0
  return points
}

function toLiftStrength(points: number): LiftStrength {
  if (points >= 7) return "strong_lift"
  if (points >= 4) return "medium_lift"
  if (points >= 2) return "weak_lift"
  return "no_lift"
}

export function computeAttribution(edge: ConsequenceEdge): LiftStrength {
  return toLiftStrength(pointsForCriteria(edge.attribution))
}

export function computeAttributionCriteria(
  decision: string,
  consequence: string,
  relation: CausalRelation,
  consequenceStatus: string,
  consequenceTags: string[],
): AttributionCriteria {
  const searchable = `${decision} ${consequence} ${consequenceTags.join(" ")} ${consequenceStatus}`.toLowerCase()
  const affectsVulnerable = VULNERABLE_TERMS.some((term) => searchable.includes(term))

  if (relation === "causes" || relation === "prevents") {
    return { directness: "direct", foreseeability: "high", controllability: "high", affectsVulnerable, horizon: "immediate" }
  }

  if (relation === "enables") {
    return { directness: "mediated", foreseeability: "medium", controllability: "partial", affectsVulnerable, horizon: "short" }
  }

  if (relation === "risks") {
    return { directness: "mediated", foreseeability: "medium", controllability: "low", affectsVulnerable, horizon: affectsVulnerable ? "short" : "medium" }
  }

  if (relation === "mitigates") {
    return { directness: "direct", foreseeability: "high", controllability: "partial", affectsVulnerable, horizon: "short" }
  }

  if (relation === "overrides") {
    return { directness: "direct", foreseeability: "high", controllability: "high", affectsVulnerable, horizon: "immediate" }
  }

  return { directness: "remote", foreseeability: "low", controllability: "low", affectsVulnerable, horizon: "medium" }
}
