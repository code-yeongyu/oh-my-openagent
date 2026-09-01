// Recall message renderer: builds the late-hidden nudge block injected as a
// hint message. The shape is a fixed contract consumed by the harness-side
// recall wiring: one sourced block per judged nudge. Empty nudges render to an
// empty string so callers inject nothing.

import type { RecallNudge } from "./gate"

export const RECALL_HINT_HEADER =
  "A stored memory surfaced. It is a hint, not current state — verify before relying on it; read the source path for full context."

/**
 * A gate-judged nudge in the same sourced framing as a lexical candidate: the judge's one-sentence
 * hint takes the place of the description and excerpt, because it already states WHY this memory
 * matters to the next turn. The header stays so the agent reads it as a hint, not as current state,
 * and the source path is what it opens for the full detail the hint had to leave out.
 */
export function renderNudgeBlock(nudge: RecallNudge): string {
  return [
    `<recalled-memory source="[[${nudge.path}]]">`,
    RECALL_HINT_HEADER,
    nudge.hint,
    "</recalled-memory>",
  ].join("\n")
}

export function renderNudgeMessage(nudges: readonly RecallNudge[]): string {
  if (nudges.length === 0) return ""
  return nudges.map(renderNudgeBlock).join("\n")
}
