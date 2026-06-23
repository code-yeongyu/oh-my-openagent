import type { AnalyzedProofChain } from "./v5-types"

type UnknownRecord = Record<string, unknown>

interface ProofStep {
  conclusion?: string
  ruleKind: "ordinary" | "strict" | "defeasible"
  ruleId?: string
  antecedents: string[]
}

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function isString(value: unknown): value is string {
  return typeof value === "string"
}

function isRuleKind(value: unknown): value is ProofStep["ruleKind"] {
  return value === "ordinary" || value === "strict" || value === "defeasible"
}

function getStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return []
  }

  return value.filter(isString)
}

function emptyAnalysis(): AnalyzedProofChain {
  return {
    ruleIds: [],
    antecedents: new Map(),
    depth: 0,
    hasCircularDependency: false,
    allPremisesOrdinary: null,
  }
}

function parseProofStep(step: unknown): ProofStep | null {
  if (!isRecord(step) || !isRuleKind(step.rule_kind)) {
    return null
  }

  return {
    conclusion: isString(step.conclusion) ? step.conclusion : undefined,
    ruleKind: step.rule_kind,
    ruleId: isString(step.rule_id) ? step.rule_id : undefined,
    antecedents: getStringArray(step.antecedents ?? step.from),
  }
}

function getProofChain(rawProofArtifact: unknown, conclusion: string): ProofStep[] {
  if (!isRecord(rawProofArtifact) || !isRecord(rawProofArtifact.result)) {
    return []
  }

  const conclusions = rawProofArtifact.result.conclusions
  if (!isRecord(conclusions)) {
    return []
  }

  const entry = conclusions[conclusion]
  if (!isRecord(entry) || !Array.isArray(entry.proof_chain)) {
    return []
  }

  const proofChain: ProofStep[] = []

  for (const step of entry.proof_chain) {
    const parsedStep = parseProofStep(step)
    if (parsedStep === null) {
      return []
    }

    proofChain.push(parsedStep)
  }

  return proofChain
}

function hasCycle(graph: Map<string, string[]>, start: string): boolean {
  const visiting = new Set<string>()
  const visited = new Set<string>()

  function dfs(node: string): boolean {
    if (visiting.has(node)) {
      return true
    }

    if (visited.has(node)) {
      return false
    }

    visiting.add(node)

    for (const antecedent of graph.get(node) ?? []) {
      if (!graph.has(antecedent)) {
        continue
      }

      if (dfs(antecedent)) {
        return true
      }
    }

    visiting.delete(node)
    visited.add(node)
    return false
  }

  return dfs(start)
}

export function analyzeProofChain(
  rawProofArtifact: unknown,
  conclusion: string
): AnalyzedProofChain {
  const proofChain = getProofChain(rawProofArtifact, conclusion)

  if (proofChain.length === 0) {
    return emptyAnalysis()
  }

  const ruleIds: string[] = []
  const antecedents = new Map<string, string[]>()
  const graph = new Map<string, string[]>()
  let depth = 0

  for (const step of proofChain) {
    if (step.ruleKind !== "ordinary") {
      depth += 1
    }

    if (step.ruleId !== undefined) {
      ruleIds.push(step.ruleId)
      antecedents.set(step.ruleId, step.antecedents)
    }

    if (step.conclusion !== undefined) {
      graph.set(step.conclusion, step.antecedents)
    }
  }

  return {
    ruleIds,
    antecedents,
    depth,
    hasCircularDependency: hasCycle(graph, conclusion),
    allPremisesOrdinary: proofChain.every((step) => step.ruleKind === "ordinary"),
  }
}
