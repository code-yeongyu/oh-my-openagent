import type { AgreementItem, MemoryExpiry } from "@oh-my-opencode/memory-core"

import { renderExpiredLine } from "./projection-expiry"
import { renderProjectedChangesLine, type ProjectionTurn } from "./projection-pin"

export const MEMORY_NUDGE_METADATA_TOKEN = "user turns since your last memory save"
export const MEMORY_SOUL_METADATA_TOKEN = "Soul updated by"
export const MEMORY_AGREEMENT_METADATA_TOKEN = "Agreement NEEDS-HUMAN"

export interface MemoryNoticeInputs {
  readonly compactedMessageCount: number
  readonly nudgeTurns: number | undefined
  readonly soulNotice: { readonly sha: string } | undefined
  readonly turn: ProjectionTurn
  readonly expired: readonly MemoryExpiry[]
  readonly flaggedAgreements: readonly AgreementItem[]
}

/**
 * Session-volatile lines only. Every line is a fact about THIS session's state; standing facts (what
 * memory is, that recall arrives on its own) live in the compiled block. No line means no notice.
 */
export function renderMemoryNotice(inputs: MemoryNoticeInputs): string | undefined {
  const { compactedMessageCount, nudgeTurns, soulNotice, turn, expired, flaggedAgreements } = inputs
  const lines = [
    ...(compactedMessageCount === 0
      ? []
      : [`- ${compactedMessageCount} earlier messages were compacted out of the live context; what still matters from them arrives on its own as <recalled-memory> blocks`]),
    ...(nudgeTurns === undefined
      ? []
      : [`- ${nudgeTurns} ${MEMORY_NUDGE_METADATA_TOKEN}. Save durable facts now, or decide nothing qualifies.`]),
    ...(soulNotice === undefined
      ? []
      : [`- ${MEMORY_SOUL_METADATA_TOKEN} reflection ${soulNotice.sha.slice(0, 7)} since your last run`]),
    ...(turn.changes === undefined ? [] : [renderProjectedChangesLine(turn.changes, turn.revision, turn.sources)]),
    ...(expired.length === 0 ? [] : [renderExpiredLine(expired)]),
    ...flaggedAgreements.map((item) =>
      `- ${MEMORY_AGREEMENT_METADATA_TOKEN} (broken x${item.n}): "${item.text}" Do not break it again this session; if the task needs it, stop and ask your person.`),
  ]
  if (lines.length === 0) return undefined
  return ["<memory_notice>", ...lines, "</memory_notice>"].join("\n")
}
