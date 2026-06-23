import type { AnalyzedProofChain, DependencyInfo } from "./v5-types"

function isDefeasibleRule(ruleId: string): boolean {
  return ruleId.startsWith("d")
}

function getSelfSufficient(chain: AnalyzedProofChain): boolean | null {
  if (chain.allPremisesOrdinary === null) {
    return null
  }

  if (chain.allPremisesOrdinary === false) {
    return false
  }

  return chain.ruleIds.length > 0
}

function getDependencyChain(chain: AnalyzedProofChain): string[] {
  const dependencyChain = new Set<string>()

  for (const ruleId of chain.ruleIds) {
    if (!isDefeasibleRule(ruleId)) {
      continue
    }

    const antecedents = chain.antecedents.get(ruleId) ?? []
    for (const antecedent of antecedents) {
      dependencyChain.add(antecedent)
    }
  }

  return [...dependencyChain]
}

export function analyzeDependency(chain: AnalyzedProofChain): DependencyInfo {
  return {
    selfSufficient: getSelfSufficient(chain),
    dependencyChain: getDependencyChain(chain),
    hasCircularDependency: chain.hasCircularDependency,
  }
}
