import type { ClassifierInput, EpistemicState } from "./types.ts"

const THETA = 0.8

export function classifyEpistemicState(input: ClassifierInput): EpistemicState {
  if (input.extensionsTotal === 0) {
    return "open"
  }

  if (input.status === undefined) {
    return "open"
  }

  if (input.status === "Accepted") {
    if (
      input.proofChainKind === "strict" &&
      input.extensionsIn === input.extensionsTotal
    ) {
      return "accepted"
    }

    if (input.extensionsIn / input.extensionsTotal >= THETA) {
      return "plausible"
    }

    return "open"
  }

  if (input.status === "Undecided") {
    return "open"
  }

  if (input.status === "Rejected") {
    if (input.hasResidualDefeasibleSupport) {
      return "operationally_excluded"
    }

    return "excluded"
  }

  return "open"
}
