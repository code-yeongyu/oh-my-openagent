// Recall message renderer: builds the late-hidden nudge block injected as a
// hint message. The shape is a fixed contract consumed by the harness-side
// recall wiring: one sourced block per judged nudge. Empty nudges render to an
// empty string so callers inject nothing.

import type { RecallNudge } from "./gate"

export const RECALL_HINT_HEADER =
  "Kibitzer recalled a stored memory. It is a hint, not current state — verify before relying on it; read the source path for full context."

export const RECALL_HINT_HEADER_KO =
  "키비처가 저장된 메모리를 짚어줬습니다. 현재 상태가 아니라 힌트입니다 — 의존하기 전에 확인하고, 전체 맥락은 출처 경로를 읽으세요."

/**
 * A gate-judged nudge in the same sourced framing as a lexical candidate: the judge's one-sentence
 * hint takes the place of the description and excerpt, because it already states WHY this memory
 * matters to the next turn. The header stays so the agent reads it as a hint, not as current state,
 * and the source path is what it opens for the full detail the hint had to leave out.
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
