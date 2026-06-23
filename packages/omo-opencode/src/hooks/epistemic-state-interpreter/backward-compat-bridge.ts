import type { EpistemicAnnotation, EpistemicState } from "./types"
import type { AmmissibilitaState, MultiPlaneAnnotation } from "./multi-plane-types"

const PIANO_A_TO_EPISTEMIC: Record<AmmissibilitaState, EpistemicState> = {
  possibile: "open",
  non_escluso: "open",
  da_verificare: "open",
  plausibile: "plausible",
  escluso_operativamente: "operationally_excluded",
  escluso: "excluded",
}

function resolveAccepted(annotation: MultiPlaneAnnotation): boolean {
  const isFullConsensus =
    annotation.extensionMembership.totalCount > 0 &&
    annotation.extensionMembership.inCount === annotation.extensionMembership.totalCount
  return annotation.state.pianoA === "plausibile" && isFullConsensus && annotation.proofChainKind === "strict"
}

export function toEpistemicState(annotation: MultiPlaneAnnotation): EpistemicState {
  if (annotation.state.pianoC.inconclusivo) {
    return "inconclusive"
  }

  if (resolveAccepted(annotation)) {
    return "accepted"
  }

  return PIANO_A_TO_EPISTEMIC[annotation.state.pianoA]
}

export function toEpistemicAnnotation(annotation: MultiPlaneAnnotation): EpistemicAnnotation {
  return {
    conclusion: annotation.conclusion,
    state: toEpistemicState(annotation),
    rawClassification: PIANO_A_TO_EPISTEMIC[annotation.rawClassification],
    reason: annotation.reason,
    timestamp: annotation.timestamp,
    callID: annotation.callID,
    proofChainKind: annotation.proofChainKind,
    extensionMembership: annotation.extensionMembership,
  }
}
