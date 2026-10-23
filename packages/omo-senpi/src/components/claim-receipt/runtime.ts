// Sidecar entry for the claim-receipt verdicts, bundled as extensions/omo-claim-receipt.js and imported through
// `#omo-claim-receipt-runtime` on the first finished answer (see runtime-loader.ts). The entry bundle keeps the
// hooks, the per-session state and the record/nudge shapes; the claim classifier, the evidence timeline and the
// matcher live here, outside the entry bundle's byte budget.

import { classifyClaims } from "./classify"
import { buildTimeline, contentText } from "./evidence"
import { type ClaimVerdict, isFlagged, matchClaims } from "./match"

export interface AnswerVerdicts {
  readonly verdicts: ClaimVerdict[]
  readonly flagged: ClaimVerdict[]
}

export function evaluateAnswer(branch: readonly unknown[], answerAt: number, content: unknown): AnswerVerdicts | undefined {
  const claims = classifyClaims(contentText(content))
  if (claims.length === 0) return undefined
  const verdicts = matchClaims(buildTimeline(branch), claims, answerAt)
  return { verdicts, flagged: verdicts.filter(isFlagged) }
}
