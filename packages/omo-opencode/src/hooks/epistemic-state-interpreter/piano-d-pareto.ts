import type { ValutazioneMultiAsse } from "./multi-plane-types"

export const PARETO_AXES = ["logico", "probabilistico", "etico", "pragmatico", "morale"] as const

export type ParetoAxis = (typeof PARETO_AXES)[number]

export interface ParetoConclusionInput {
  conclusion: string
  valutazione: ValutazioneMultiAsse
  blocked: boolean
}

export interface AxisDelta {
  axis: ParetoAxis
  superiorScore: number
  inferiorScore: number
}

export interface ParetoEdge {
  dominant: string
  dominated: string
  reason: AxisDelta[]
}

export interface ParetoResult {
  pareto_optimal: string[]
  edges: ParetoEdge[]
  incomparable_pairs: Array<[string, string]>
  blocked: string[]
}

export function getParetoAxisScore(valutazione: ValutazioneMultiAsse, axis: ParetoAxis): number {
  switch (axis) {
    case "logico":
      return valutazione.logico
    case "probabilistico":
      return valutazione.probabilistico
    case "etico":
      return valutazione.etico.score ?? 0
    case "pragmatico":
      return valutazione.pragmatico.score
    case "morale":
      return valutazione.morale.score ?? 0
  }
}

interface DominanceComparison {
  dominates: boolean
  reason: AxisDelta[]
}

function compareDominance(
  superior: ParetoConclusionInput,
  inferior: ParetoConclusionInput,
): DominanceComparison {
  const reason: AxisDelta[] = []
  let strictlyBetterOnAtLeastOne = false

  for (const axis of PARETO_AXES) {
    const superiorScore = getParetoAxisScore(superior.valutazione, axis)
    const inferiorScore = getParetoAxisScore(inferior.valutazione, axis)

    if (superiorScore < inferiorScore) {
      return { dominates: false, reason: [] }
    }

    if (superiorScore > inferiorScore) {
      reason.push({ axis, superiorScore, inferiorScore })
      strictlyBetterOnAtLeastOne = true
    }
  }

  return { dominates: strictlyBetterOnAtLeastOne, reason }
}

export function computeParetoDominance(input: {
  conclusions: ParetoConclusionInput[]
}): ParetoResult {
  if (input.conclusions.length === 0) {
    return { pareto_optimal: [], edges: [], incomparable_pairs: [], blocked: [] }
  }

  const blocked = input.conclusions.filter((entry) => entry.blocked)
  const unblocked = input.conclusions.filter((entry) => !entry.blocked)

  const edges: ParetoEdge[] = []
  for (const blockedEntry of blocked) {
    for (const unblockedEntry of unblocked) {
      edges.push({
        dominant: unblockedEntry.conclusion,
        dominated: blockedEntry.conclusion,
        reason: [],
      })
    }
  }

  for (const left of unblocked) {
    for (const right of unblocked) {
      if (left.conclusion === right.conclusion) continue
      const comparison = compareDominance(left, right)
      if (comparison.dominates) {
        edges.push({ dominant: left.conclusion, dominated: right.conclusion, reason: comparison.reason })
      }
    }
  }

  const dominatedSet = new Set(edges.map((edge) => edge.dominated))
  const paretoOptimal = unblocked
    .filter((entry) => !dominatedSet.has(entry.conclusion))
    .map((entry) => entry.conclusion)

  const incomparablePairs: Array<[string, string]> = []
  const seenPairs = new Set<string>()
  for (let leftIndex = 0; leftIndex < unblocked.length; leftIndex += 1) {
    for (let rightIndex = leftIndex + 1; rightIndex < unblocked.length; rightIndex += 1) {
      const left = unblocked[leftIndex].conclusion
      const right = unblocked[rightIndex].conclusion
      const pairKey = `${left}|${right}`
      if (seenPairs.has(pairKey)) continue
      seenPairs.add(pairKey)

      const leftDominatesRight = edges.some((edge) => edge.dominant === left && edge.dominated === right)
      const rightDominatesLeft = edges.some((edge) => edge.dominant === right && edge.dominated === left)
      if (!leftDominatesRight && !rightDominatesLeft) {
        incomparablePairs.push([left, right])
      }
    }
  }

  return {
    pareto_optimal: paretoOptimal,
    edges,
    incomparable_pairs: incomparablePairs,
    blocked: blocked.map((entry) => entry.conclusion),
  }
}
