import type { ClaimVerdict, UnsupportedReason } from "./match"

export const VERDICT_ENTRY_TYPE = "omo-claim-receipt:verdict"
export const NUDGE_MESSAGE_TYPE = "omo-claim-receipt:nudge"
export const GATE_FLAGS_TAG = "claim-receipt-flags"

export interface VerdictRecord {
  readonly version: 1
  readonly answerEntryId: string
  readonly epoch: number
  readonly flagged: boolean
  readonly nudged: boolean
  readonly verdicts: readonly ClaimVerdict[]
}

const REASON_TEXT: Readonly<Record<UnsupportedReason, string>> = {
  "no-check": "no check ran before this claim",
  "last-check-failed": "the latest matching check before this claim failed",
  "stale-after-edit": "code was edited after the last passing check",
}

const quote = (sentence: string): string => JSON.stringify(sentence.length > 200 ? `${sentence.slice(0, 197)}...` : sentence)

function describe(verdict: ClaimVerdict): string {
  const reason = verdict.reason === undefined ? "unsupported" : REASON_TEXT[verdict.reason]
  const check = verdict.receipt === undefined ? "" : ` (check entry ${verdict.receipt.entryId}, ${verdict.receipt.kind} ${verdict.receipt.outcome})`
  const edit = verdict.invalidatedBy === undefined ? "" : ` (edit entry ${verdict.invalidatedBy.entryId}${verdict.invalidatedBy.paths.length > 0 ? `: ${verdict.invalidatedBy.paths.join(", ")}` : ""})`
  return `- ${quote(verdict.claim.sentence)}: ${reason}${check}${edit}`
}

export function nudgeText(flagged: readonly ClaimVerdict[]): string {
  return [
    "<claim-receipt>",
    "Your last answer states results that no check result in this session supports:",
    ...flagged.map(describe),
    "Run the check and report its actual result, or say plainly that it was not verified. This is advisory and is shown once per user message.",
    "</claim-receipt>",
  ].join("\n")
}

export function gateFlagsBlock(flagged: readonly ClaimVerdict[]): string {
  return [
    `<${GATE_FLAGS_TAG}>`,
    "The parent session made these success claims without a supporting check result (claim-receipt). Treat each as unverified and reproduce it from the artifacts:",
    ...flagged.map(describe),
    `</${GATE_FLAGS_TAG}>`,
  ].join("\n")
}
