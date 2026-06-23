import type { ConfidenceWeights } from "../../config/schema/epistemic-v5"
import { clearAnnotations, getAnnotations, storeAnnotations } from "./annotation-store"
import { computeConfidence } from "./confidence-scorer"
import { analyzeDependency } from "./dependency-analyzer"
import { rankDominance } from "./dominance-ranker"
import { analyzeProofChain } from "./proof-chain-analyzer"
import { resolveState } from "./state-resolver"
import type { InconclusiveThresholds } from "./state-resolver"

export interface EnricherConfig {
  confidenceWeights: ConfidenceWeights
  dominanceThreshold: number
  inconclusiveThresholds: InconclusiveThresholds
}

export function enrichAnnotations(
  sessionId: string,
  rawProofArtifact: unknown,
  config: EnricherConfig,
): void {
  const annotations = getAnnotations(sessionId)
  if (annotations.length === 0) {
    return
  }

  const enriched = annotations.map((annotation) => {
    const chain = analyzeProofChain(rawProofArtifact, annotation.conclusion)
    const confidence = computeConfidence(annotation.extensionMembership, chain, config.confidenceWeights)
    const dependency = analyzeDependency(chain)
    return { ...annotation, confidence, dependency }
  })

  const dominance = rankDominance(enriched, config.dominanceThreshold)
  const resolved = enriched.map((annotation) => ({
    ...annotation,
    state: resolveState(
      annotation.state,
      annotation.confidence,
      annotation.dependency,
      dominance,
      config.inconclusiveThresholds,
    ).state as typeof annotation.state,
  }))

  clearAnnotations(sessionId)
  storeAnnotations(sessionId, resolved)
}
