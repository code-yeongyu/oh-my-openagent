import { analyzeDependency } from "./dependency-analyzer"
import type { PotenzaInferenziale } from "./multi-plane-types"
import type { AnalyzedProofChain } from "./v5-types"

function getHasWeakSupport(extensionMembership: {
  inCount: number
  totalCount: number
}): boolean {
  if (extensionMembership.totalCount <= 0) {
    return true
  }

  return extensionMembership.inCount < extensionMembership.totalCount * 0.5
}

export function computePianoC(
  chain: AnalyzedProofChain,
  extensionMembership: { inCount: number; totalCount: number },
): PotenzaInferenziale {
  const dependency = analyzeDependency(chain)
  const hasWeakSupport = getHasWeakSupport(extensionMembership)

  return {
    inconclusivo:
      dependency.selfSufficient === false &&
      hasWeakSupport &&
      dependency.dependencyChain.length > 0,
    autosufficiente: dependency.selfSufficient,
    catena_dipendenze: dependency.dependencyChain,
    ha_dipendenza_circolare: dependency.hasCircularDependency,
  }
}
