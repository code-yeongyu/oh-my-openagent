import type { ConfidenceWeights } from "../../config/schema/epistemic-v5"
import type { AnalyzedProofChain, ConfidenceScore } from "./v5-types"

function getProofChainDepthFactor(analyzedChain: AnalyzedProofChain): number | null {
  const isEmptyChain = analyzedChain.depth === 0 && analyzedChain.ruleIds.length === 0

  if (isEmptyChain) {
    return null
  }

  return analyzedChain.depth / (analyzedChain.depth + 1)
}

function getRuleStrengthFactor(analyzedChain: AnalyzedProofChain): number | null {
  if (analyzedChain.ruleIds.length === 0) {
    return null
  }

  return 0.5
}

export function computeConfidence(
  extensionMembership: { inCount: number; totalCount: number },
  analyzedChain: AnalyzedProofChain,
  weights: ConfidenceWeights,
): ConfidenceScore {
  const extensionRatio =
    extensionMembership.totalCount === 0
      ? null
      : extensionMembership.inCount / extensionMembership.totalCount

  const proofChainDepth = getProofChainDepthFactor(analyzedChain)
  const ruleStrength = getRuleStrengthFactor(analyzedChain)

  const availableFactors = [
    { value: extensionRatio, weight: weights.extensionRatio },
    { value: proofChainDepth, weight: weights.proofChainDepth },
    { value: ruleStrength, weight: weights.ruleStrength },
  ].filter((factor): factor is { value: number; weight: number } => factor.value !== null)

  if (availableFactors.length === 0) {
    return {
      value: null,
      factors: {
        extensionRatio,
        proofChainDepth,
        ruleStrength,
      },
      reason: "no_data",
    }
  }

  const totalWeight = availableFactors.reduce((sum, factor) => sum + factor.weight, 0)
  const value =
    totalWeight === 0
      ? null
      : availableFactors.reduce((sum, factor) => sum + factor.value * factor.weight, 0) / totalWeight

  return {
    value,
    factors: {
      extensionRatio,
      proofChainDepth,
      ruleStrength,
    },
    reason: value === null ? "no_data" : null,
  }
}
