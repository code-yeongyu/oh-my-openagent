import { classifyConclusion } from "./decision-registry"
import type { AttributionCriteria, ConsequenceEdge, ConsequenceGraph, CausalRelation, LiftStrength } from "./types"

export interface ProofStep {
  conclusion?: string
  from?: string[]
  antecedents?: string[]
  rule_kind?: string
}

interface ConclusionEntry {
  status: string
  proofChain: ProofStep[]
  tags?: string[]
}

const DEFAULT_ATTRIBUTION: AttributionCriteria = {
  directness: "remote",
  foreseeability: "low",
  controllability: "low",
  affectsVulnerable: false,
  horizon: "medium",
}

function createEdge(from: string, to: string, relation: CausalRelation): ConsequenceEdge {
  return { from, to, relation, attribution: DEFAULT_ATTRIBUTION, liftStrength: "no_lift" satisfies LiftStrength }
}

function getAntecedents(proofChain: ProofStep[]): string[] {
  return [...new Set(proofChain.flatMap((step) => step.from ?? step.antecedents ?? []))]
}

function getConclusionReferences(antecedents: string[], allConclusions: Map<string, ConclusionEntry>): string[] {
  return antecedents.filter((antecedent) => allConclusions.has(antecedent))
}

function inferRelation(conclusion: string, tags: string[], direct: boolean): CausalRelation {
  if (conclusion.startsWith("-")) return "prevents"
  if (/(harm|collapse|damage|injury)/i.test(conclusion) && direct) return "causes"
  if (tags.some((tag) => tag.startsWith("safety:") || tag.startsWith("risk:"))) return "risks"
  return direct ? "causes" : "enables"
}

function addUniqueEdge(edges: ConsequenceEdge[], edge: ConsequenceEdge): void {
  const exists = edges.some((candidate) => candidate.from === edge.from && candidate.to === edge.to && candidate.relation === edge.relation)
  if (!exists) edges.push(edge)
}

function isReachableFromDecision(
  conclusion: string,
  decision: string,
  dependencies: Map<string, string[]>,
  maxHops: number,
): { reached: boolean; hops: number } {
  const visited = new Set<string>()
  const queue: Array<{ node: string; depth: number }> = [{ node: conclusion, depth: 0 }]

  while (queue.length > 0) {
    const current = queue.shift()!
    if (current.depth > maxHops) continue
    if (visited.has(current.node)) continue
    visited.add(current.node)

    const antecedents = dependencies.get(current.node) ?? []
    if (antecedents.includes(decision)) {
      return { reached: true, hops: current.depth + 1 }
    }

    if (current.depth + 1 < maxHops) {
      for (const antecedent of antecedents) {
        if (!visited.has(antecedent)) {
          queue.push({ node: antecedent, depth: current.depth + 1 })
        }
      }
    }
  }

  return { reached: false, hops: 0 }
}

export function buildConsequenceGraph(
  decisions: string[],
  allConclusions: Map<string, ConclusionEntry>,
  maxHops: number,
): ConsequenceGraph {
  const edges: ConsequenceEdge[] = []
  const directDependencies = new Map<string, string[]>()

  for (const [conclusion, entry] of allConclusions.entries()) {
    directDependencies.set(conclusion, getConclusionReferences(getAntecedents(entry.proofChain), allConclusions))
  }

  for (const [conclusion, entry] of allConclusions.entries()) {
    const antecedents = directDependencies.get(conclusion) ?? []
    const tags = entry.tags ?? []
    const role = classifyConclusion(conclusion, tags)

    for (const decision of decisions) {
      if (decision === conclusion) continue
      const reachable = isReachableFromDecision(conclusion, decision, directDependencies, maxHops)
      if (reachable.reached) {
        addUniqueEdge(edges, createEdge(decision, conclusion, inferRelation(conclusion, tags, reachable.hops === 1)))
      }
    }

    if (role === "mitigation") {
      for (const antecedent of antecedents) {
        addUniqueEdge(edges, createEdge(conclusion, antecedent, "mitigates"))
      }
    }

    if (role === "compensation") {
      for (const antecedent of antecedents) {
        addUniqueEdge(edges, createEdge(conclusion, antecedent, "compensates"))
      }
    }

    if (role === "guardrail") {
      for (const antecedent of antecedents) {
        addUniqueEdge(edges, createEdge(conclusion, antecedent, "guardrails"))
      }
    }

    if (role === "trigger" || role === "structural_constraint") {
      for (const antecedent of antecedents) {
        addUniqueEdge(edges, createEdge(conclusion, antecedent, "invalidates"))
      }
    }

    if (role === "repair_obligation") {
      for (const antecedent of antecedents) {
        addUniqueEdge(edges, createEdge(conclusion, antecedent, "repairs"))
      }
    }

    if (role === "override") {
      for (const antecedent of antecedents) {
        addUniqueEdge(edges, createEdge(conclusion, antecedent, "overrides"))
      }
    }
  }

  return { decisions, edges }
}
