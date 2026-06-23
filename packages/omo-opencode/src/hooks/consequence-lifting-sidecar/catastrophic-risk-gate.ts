import type { ConsequenceGraph } from "./types"
import type { CatastrophicClassification } from "./catastrophic-risk-types"

export interface CatastrophicGateOptions {
  blockEnabled?: boolean
}

export interface CatastrophicGateResult {
  gated: Map<string, boolean>
  blocked: string[]
}

export function applyCatastrophicGate(
  decisions: string[],
  graph: ConsequenceGraph,
  classifications: Map<string, CatastrophicClassification>,
  options: CatastrophicGateOptions = {},
): CatastrophicGateResult {
  const gated = new Map(
    decisions.map((decision) => {
      const isGated = graph.edges.some(
        (edge) => edge.from === decision && classifications.get(edge.to)?.level === "catastrophic",
      )
      return [decision, isGated]
    }),
  )

  const blocked = options.blockEnabled === true
    ? decisions.filter((decision) => gated.get(decision) === true)
    : []

  return { gated, blocked }
}
