import type { ConfidenceWeights } from "../../config/schema/epistemic-v5"
import type { ForzaQuantitativa } from "./multi-plane-types"
import type { AnalyzedProofChain } from "./v5-types"

function getExtensionRatio(extensionMembership: { inCount: number; totalCount: number }): number | null {
  if (extensionMembership.totalCount === 0) {
    return null
  }

  return extensionMembership.inCount / extensionMembership.totalCount
}

function getProofChainDepthFactor(chain: AnalyzedProofChain): number | null {
  const isEmptyChain = chain.depth === 0 && chain.ruleIds.length === 0

  if (isEmptyChain) {
    return null
  }

  return chain.depth / (chain.depth + 1)
}

function getRuleStrengthFactor(chain: AnalyzedProofChain): number | null {
  if (chain.ruleIds.length === 0) {
    return null
  }

  return 0.5
}

function getProbabile(
  extensionMembership: { inCount: number; totalCount: number },
  chain: AnalyzedProofChain,
  weights: ConfidenceWeights,
): number | null {
  const availableFactors = [
    { value: getExtensionRatio(extensionMembership), weight: weights.extensionRatio },
    { value: getProofChainDepthFactor(chain), weight: weights.proofChainDepth },
    { value: getRuleStrengthFactor(chain), weight: weights.ruleStrength },
  ].filter((factor): factor is { value: number; weight: number } => factor.value !== null)

  if (availableFactors.length === 0) {
    return null
  }

  const totalWeight = availableFactors.reduce((sum, factor) => sum + factor.weight, 0)

  if (totalWeight === 0) {
    return null
  }

  return availableFactors.reduce((sum, factor) => sum + factor.value * factor.weight, 0) / totalWeight
}

export function computePianoB(
  extensionMembership: { inCount: number; totalCount: number },
  chain: AnalyzedProofChain,
  weights: ConfidenceWeights,
  plausibilitaThreshold: number,
): ForzaQuantitativa {
  const probabile = getProbabile(extensionMembership, chain, weights)

  return {
    probabile,
    plausibile: probabile !== null && probabile > plausibilitaThreshold,
  }
}
