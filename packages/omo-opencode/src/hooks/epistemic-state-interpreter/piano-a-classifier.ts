import type { AmmissibilitaState } from "./multi-plane-types.ts"
import type { ClassifierInput } from "./types.ts"

function hasSupportInAllExtensions({
  extensionsIn,
  extensionsTotal,
}: ClassifierInput): boolean {
  return extensionsTotal > 0 && extensionsIn === extensionsTotal
}

function hasSupportInSomeExtensions({
  extensionsIn,
  extensionsTotal,
}: ClassifierInput): boolean {
  return extensionsIn > 0 && extensionsIn < extensionsTotal
}

function hasStrongProofChain({ proofChainKind }: ClassifierInput): boolean {
  return proofChainKind === "strict" || proofChainKind === "mixed"
}

export function classifyPianoA(input: ClassifierInput): AmmissibilitaState {
  if (input.status === undefined || input.extensionsTotal === 0) {
    return "possibile"
  }

  if (input.status === "Rejected") {
    return input.hasResidualDefeasibleSupport
      ? "escluso_operativamente"
      : "escluso"
  }

  if (input.status === "Accepted") {
    if (hasSupportInAllExtensions(input)) {
      return hasStrongProofChain(input) ? "plausibile" : "non_escluso"
    }

    if (hasSupportInSomeExtensions(input)) {
      return "non_escluso"
    }

    return "possibile"
  }

  if (input.status === "Undecided" || hasSupportInSomeExtensions(input)) {
    return "possibile"
  }

  return "possibile"
}
