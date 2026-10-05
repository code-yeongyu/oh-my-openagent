// The RESEED envelope: the seed of a replacement child after the previous one hit its context
// budget. It carries the state a restart would otherwise lose - rejected paths, delivered paths,
// the task summary and the last cursor - inside a whole-envelope bound, so a restart never
// re-explodes the context it is escaping.

import { escapeText, openTag, renderContract, renderTask, resolveCaps, type KibitzerFieldCaps } from "./sidecar-prompt-blocks"

/** Bound on a whole reseed envelope: a restart must never re-explode the context it is escaping. */
export const KIBITZER_RESEED_MAX_CHARS = 4000

export interface KibitzerReseedInput {
  readonly sessionId: string
  readonly maxItems: number
  /** The newest parent cursor the disposed child had seen; the new child resumes from here. */
  readonly lastCursor: number
  /** One line naming what the parent is working on. */
  readonly taskSummary: string
  /** Paths offered to the disposed child that it declined; they are not worth re-judging. */
  readonly rejectedPaths: readonly string[]
  /** Paths already delivered to the parent; they can never be nudged again. */
  readonly deliveredPaths: readonly string[]
  readonly toolBudget?: number
  readonly caps?: Partial<KibitzerFieldCaps>
  /** Whole-envelope bound; defaults to {@link KIBITZER_RESEED_MAX_CHARS}. */
  readonly maxChars?: number
}

/**
 * The seed of a replacement child after the previous one hit its context budget. It carries the
 * state a restart would otherwise lose - rejected paths, delivered paths, the task summary and the
 * last cursor - and never exceeds its bound: path lists are trimmed (with the omitted counts
 * reported) before the envelope can grow past `maxChars`.
 */
export function renderKibitzerReseedPrompt(input: KibitzerReseedInput): string {
  const caps = resolveCaps(input.caps)
  const bound = input.maxChars ?? KIBITZER_RESEED_MAX_CHARS
  const head = [
    openTag("kibitzer-reseed", [
      ["version", "1"],
      ["session", input.sessionId],
      ["cursor", input.lastCursor],
      ["max-items", input.maxItems],
      ...(input.toolBudget === undefined ? [] : [["tool-budget", input.toolBudget] as const]),
    ]),
    renderContract(),
    renderTask(input.taskSummary, caps),
  ].join("\n")
  const rejected = input.rejectedPaths.map((path) => `<path>${escapeText(path)}</path>`)
  const delivered = input.deliveredPaths.map((path) => `<path>${escapeText(path)}</path>`)
  // The fixed part is measured with the largest omitted counts the lists can produce, so the
  // rendered envelope can only be shorter than the length this budget was computed from.
  const fixed = reseedEnvelope(head, { lines: [], total: rejected.length }, { lines: [], total: delivered.length }).length
  const budget = bound - fixed
  const keptRejected = fitLines(rejected, Math.floor(budget / 2))
  const keptDelivered = fitLines(delivered, budget - keptRejected.used)
  return reseedEnvelope(
    head,
    { lines: keptRejected.lines, total: rejected.length },
    { lines: keptDelivered.lines, total: delivered.length },
  )
}

function reseedEnvelope(
  head: string,
  rejected: { readonly lines: readonly string[]; readonly total: number },
  delivered: { readonly lines: readonly string[]; readonly total: number },
): string {
  return [
    head,
    renderPathList("rejected", rejected.lines, rejected.total),
    renderPathList("delivered", delivered.lines, delivered.total),
    "</kibitzer-reseed>",
    "",
  ].join("\n")
}

function renderPathList(tag: string, lines: readonly string[], total: number): string {
  const open = openTag(tag, [["count", lines.length], ["omitted", total - lines.length]])
  return lines.length === 0 ? `${open}</${tag}>` : [open, ...lines, `</${tag}>`].join("\n")
}

/** Greedily keeps whole lines (with their newline) while they fit the budget; never splits one. */
function fitLines(lines: readonly string[], budget: number): { readonly lines: string[]; readonly used: number } {
  const kept: string[] = []
  let used = 0
  for (const line of lines) {
    const cost = line.length + 1
    if (used + cost > budget) break
    kept.push(line)
    used += cost
  }
  return { lines: kept, used }
}
