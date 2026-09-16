// Recall message renderer: builds the late-hidden nudge block injected as a
// hint message. The shape is a fixed contract consumed by the harness-side
// recall wiring: one sourced block per judged nudge. Empty nudges render to an
// empty string so callers inject nothing.

import type { RecallNudge } from "./gate"

export const RECALL_HINT_HEADER =
  "Kibitzer, a background memory advisor, surfaced this stored note. It may or may not apply: reference only; your current task stands."

export const RECALL_HINT_HEADER_KO =
  "백그라운드 메모리 조언자 키비처가 짚어준 저장 메모입니다. 맞을 수도 아닐 수도 있으니 참고만 하고, 하던 작업은 그대로 이어가세요."

/**
 * A gate-judged nudge in the same sourced framing as a lexical candidate: the judge's one-sentence
 * hint takes the place of the description and excerpt, because it already states what the stored
 * note records. The header names the sender and the posture (reference only, current task stands)
 * so the block carries no instruction of its own; the source path is there when the agent wants the
 * detail the hint had to leave out.
 */
export function renderNudgeBlock(nudge: RecallNudge): string {
  const escapeMarkup = (value: string): string => value
    .replaceAll("&", "&amp;")
    .replaceAll('"', "&quot;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
  return [
    `<recalled-memory source="[[${escapeMarkup(nudge.path)}]]">`,
    /[\uAC00-\uD7A3]/.test(nudge.hint) ? RECALL_HINT_HEADER_KO : RECALL_HINT_HEADER,
    escapeMarkup(nudge.hint),
    "</recalled-memory>",
  ].join("\n")
}

export function renderNudgeMessage(nudges: readonly RecallNudge[]): string {
  if (nudges.length === 0) return ""
  return nudges.map(renderNudgeBlock).join("\n")
}
