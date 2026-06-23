import type { ConsequenceGraph, ForwardBurden, MitigationBinding, MitigationStatus } from "./types"

const SEMANTIC_ASSOCIATIONS: Record<string, string[]> = {
  disclosure: ["trust", "transparency", "fiducia", "opacita"],
  monitoring: ["risk", "rischio", "safety", "fetal", "pregnant"],
  compensation: ["exposure", "vulnerable", "inequity", "disparity"],
  hybrid: ["backup", "cistern", "alternative", "redundancy"],
  override: ["consent", "necessity", "emergency"],
  transparency: ["trust", "disclosure", "fiducia"],
}

function semanticMatch(left: string, right: string): boolean {
  const leftTokens = left.toLowerCase().split(/[^a-z0-9]+/).filter((t) => t.length > 3)
  const rightTokens = right.toLowerCase().split(/[^a-z0-9]+/).filter((t) => t.length > 3)

  for (const token of leftTokens) {
    const associations = SEMANTIC_ASSOCIATIONS[token]
    if (!associations) continue
    if (rightTokens.some((rt) => associations.includes(rt))) return true
  }

  for (const token of rightTokens) {
    const associations = SEMANTIC_ASSOCIATIONS[token]
    if (!associations) continue
    if (leftTokens.some((lt) => associations.includes(lt))) return true
  }

  return false
}

const STOPWORDS = new Set(["mandatory", "continuous", "monitoring", "compensation", "require", "ensure", "verify"])

function tokenize(value: string): string[] {
  return value.toLowerCase().split(/[^a-z0-9]+/).filter((token) => token.length > 3 && !STOPWORDS.has(token))
}

function sharedTerms(left: string, right: string): boolean {
  const leftTerms = new Set(tokenize(left))
  return tokenize(right).some((term) => leftTerms.has(term))
}

function strongerStatus(left: MitigationStatus, right: MitigationStatus): MitigationStatus {
  const ranking = { unmitigated: 0, partially_mitigated: 1, sufficiently_mitigated: 2 }
  return ranking[left] >= ranking[right] ? left : right
}

export function bindMitigations(
  burdens: ForwardBurden[],
  acceptedMitigations: string[],
  graph: ConsequenceGraph,
): MitigationBinding[] {
  const bindings: MitigationBinding[] = []

  for (const mitigation of acceptedMitigations) {
    const explicitTargets = graph.edges
      .filter((edge) => edge.from === mitigation && (edge.relation === "mitigates" || edge.relation === "compensates" || edge.relation === "guardrails"))
      .map((edge) => edge.to)

    for (const burden of burdens) {
      const matches = explicitTargets.includes(burden.conclusion) || sharedTerms(mitigation, burden.conclusion) || semanticMatch(mitigation, burden.conclusion)
      if (!matches) continue

      const relation = graph.edges.find((edge) => edge.from === mitigation && edge.to === burden.conclusion)?.relation
      const effectiveness = relation === "compensates"
        ? "partially_mitigated"
        : burden.liftStrength === "weak_lift"
          ? "sufficiently_mitigated"
          : "partially_mitigated"
      const required = burden.liftStrength === "strong_lift" || burden.liftStrength === "medium_lift"
      bindings.push({ mitigation, targetBurden: burden.conclusion, effectiveness, required })

      burden.mitigatedBy.push(mitigation)
      burden.mitigationStatus = strongerStatus(burden.mitigationStatus, effectiveness)
    }
  }

  for (const burden of burdens) {
    if (burden.mitigationStatus !== "unmitigated") continue
    const upstreamMitigated = burdens.filter(
      (b) => b.mitigationStatus !== "unmitigated" && graph.edges.some(
        (e) => e.to === burden.conclusion && (e.from === b.conclusion || graph.edges.some((e2) => e2.to === burden.conclusion && e2.from === b.conclusion)),
      ),
    )

    if (upstreamMitigated.length > 0) {
      burden.mitigationStatus = "partially_mitigated"
      burden.mitigatedBy.push(...upstreamMitigated.flatMap((b) => b.mitigatedBy))
    }
  }

  return bindings
}
