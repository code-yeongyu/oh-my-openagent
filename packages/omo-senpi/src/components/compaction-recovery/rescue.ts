// Deterministic last-resort trim for the #6871 deadlock. The engine's own
// deterministic fallback tries only the prepared boundary and the single latest
// user turn; when neither fits the retention budget it gives up and the session
// deadlocks above the threshold. This planner keeps shrinking the retained suffix
// over SAFE boundaries (user or assistant message entries, never a toolResult-first
// suffix, so no dangling tool pairs) and hands the precomputed result to the engine
// through applyCompaction, which re-validates overflow and staleness.

export interface RescueUsage {
  tokens: number | null
  contextWindow: number
}

export interface RescueCompactionPlan {
  summary: string
  firstKeptEntryId: string
  tokensBefore: number
  details: Record<string, unknown>
}

/** Headroom for the checkpoint summary itself plus estimator slack. */
const SUMMARY_RESERVE_TOKENS = 512

// One token can never encode more than one UTF-8 byte, so serialized byte length is the only
// ratio that is a guaranteed upper bound. A /3 divisor holds for prose but not for token-dense
// text (CJK, base64, minified JSON), where it UNDER-counts and lets the planner hand the engine a
// suffix its own validation then rejects - leaving the deadlock this component exists to break.
const BYTES_PER_TOKEN = 1

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null
}

/**
 * Conservative per-entry token estimate: the serialized UTF-8 byte length, matching the engine's
 * own floor of at least one byte per token. Estimates therefore stay >= the engine's token counts,
 * so a plan that fits here also fits the engine's would-overflow validation.
 */
export function estimateEntryTokens(entry: unknown): number {
  if (!isRecord(entry)) return Number.POSITIVE_INFINITY
  let serialized: string | undefined
  try {
    serialized = JSON.stringify(entry)
  } catch {
    return Number.POSITIVE_INFINITY
  }
  if (serialized === undefined) return Number.POSITIVE_INFINITY
  const bytes = Buffer.byteLength(serialized)
  return Math.ceil(bytes / BYTES_PER_TOKEN)
}

/**
 * A boundary is safe when the retained suffix starts with a user or assistant
 * message: tool results reference a tool call that lives BEFORE them, so starting
 * there would dangle a tool pair in the rebuilt context.
 */
function isSafeBoundary(entry: unknown): boolean {
  if (!isRecord(entry)) return false
  const message = entry["message"]
  if (!isRecord(message)) return false
  return message["role"] === "user" || message["role"] === "assistant"
}

export function buildRescueSummary(retainedCount: number): string {
  return [
    "[Deterministic compaction recovery checkpoint]",
    "Generated summarization did not complete, so older context was reduced without another provider request.",
    `Retained suffix: the ${retainedCount} most recent transcript entries follow this checkpoint.`,
    "Continue from the retained messages after this checkpoint. Treat omitted transcript details as unknown.",
  ].join("\n")
}

export interface PlanRescueCompactionInput {
  entries: readonly unknown[]
  usage: RescueUsage
  reserveTokens: number
}

/**
 * Pick the EARLIEST safe boundary whose retained suffix still fits the retention
 * budget (contextWindow - reserveTokens): maximum retention that fits. Returns
 * undefined when even the smallest safe suffix misses the budget.
 */
export function planRescueCompaction(input: PlanRescueCompactionInput): RescueCompactionPlan | undefined {
  const { entries, usage, reserveTokens } = input
  if (entries.length === 0) return undefined

  const budget = usage.contextWindow - reserveTokens - SUMMARY_RESERVE_TOKENS
  if (budget <= 0) return undefined

  // Suffix sums from the end: suffixTokens[i] = estimate(entries[i..end]).
  const suffixTokens = new Array<number>(entries.length)
  let running = 0
  for (let index = entries.length - 1; index >= 0; index--) {
    running += estimateEntryTokens(entries[index])
    suffixTokens[index] = running
  }

  for (let index = 0; index < entries.length; index++) {
    const entry = entries[index]
    if (!isSafeBoundary(entry)) continue
    if (suffixTokens[index] === undefined || !Number.isFinite(suffixTokens[index])) continue
    if (suffixTokens[index] > budget) continue
    const firstKeptEntryId = (entry as Record<string, unknown>)["id"]
    if (typeof firstKeptEntryId !== "string" || firstKeptEntryId.length === 0) continue
    const retainedCount = entries.length - index
    return {
      summary: buildRescueSummary(retainedCount),
      firstKeptEntryId,
      tokensBefore: usage.tokens ?? 0,
      details: {
        schema: "omo.compaction-recovery.v1",
        origin: "required-compaction-recovery-rescue",
        failureKind: "summarization-gaveup-deadlock",
        retainedSuffixEntries: retainedCount,
        estimatedRetainedTokens: suffixTokens[index],
      },
    }
  }
  return undefined
}
