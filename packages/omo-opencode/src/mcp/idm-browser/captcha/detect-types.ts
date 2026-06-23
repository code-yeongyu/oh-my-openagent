import type { ChallengeKind } from "../types"

export type DetectedChallenge = {
  kind: ChallengeKind
  confidence: number
  selector?: string
  iframeUrl?: string
}
