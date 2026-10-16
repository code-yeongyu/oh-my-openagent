// When may the resident Kibitzer be woken, and when must it stay asleep?
//
// The one-shot judge answered every trigger with a fresh child. The resident child has already
// seen everything it was ever offered, so the only reason to spend a provider turn is a candidate
// memory path it has NOT seen yet and that the session has not surfaced. Everything else buffers:
// the events are still captured, they simply ride along with the next real wake. The same module
// owns the two rate limits that govern how often the sidecar may speak (the accepted-nudge cooldown,
// charged only when a wake actually delivered) and how soon it may be revived after a child died
// (exponential backoff with jitter).

import type { RecallCandidate } from "@oh-my-opencode/memory-core"

/** Fixed advisory budget, not config: at most two accepted-nudge wakes per ten minutes per main session. */
export const ACCEPTED_NUDGE_COOLDOWN_LIMIT = 2
export const ACCEPTED_NUDGE_COOLDOWN_WINDOW_MS = 600_000

/** Child-failure backoff band: the first retry waits a second, a streak tops out at five minutes. */
export const KIBITZER_BACKOFF_MIN_MS = 1_000
export const KIBITZER_BACKOFF_MAX_MS = 300_000

export interface AcceptedNudgeCooldownOptions {
  readonly now?: () => number
  readonly limit?: number
  readonly windowMs?: number
}

export interface AcceptedNudgeCooldown {
  readonly limit: number
  readonly windowMs: number
  /** True while the window already holds `limit` charges: a fresh candidate buffers instead of waking. */
  exhausted(): boolean
  /** Records one wake that delivered at least one accepted nudge. Empty wakes are never charged. */
  charge(): void
  /** Charges still inside the window. */
  charges(): number
}

export function createAcceptedNudgeCooldown(options: AcceptedNudgeCooldownOptions = {}): AcceptedNudgeCooldown {
  const now = options.now ?? Date.now
  const limit = options.limit ?? ACCEPTED_NUDGE_COOLDOWN_LIMIT
  const windowMs = options.windowMs ?? ACCEPTED_NUDGE_COOLDOWN_WINDOW_MS
  let chargedAt: number[] = []

  function live(): number[] {
    const start = now() - windowMs
    chargedAt = chargedAt.filter((timestamp) => timestamp > start)
    return chargedAt
  }

  return {
    limit,
    windowMs,
    exhausted: () => live().length >= limit,
    charge() {
      live().push(now())
    },
    charges: () => live().length,
  }
}

export type WakeSilenceReason = "max_items_zero" | "no_candidates" | "no_new_candidate" | "cooldown"

export type WakeDecision =
  /** `candidates` are the fresh, nudge-eligible ones in batch order; the envelope carries exactly these. */
  | { readonly wake: true; readonly candidates: readonly RecallCandidate[] }
  | { readonly wake: false; readonly reason: WakeSilenceReason }

export interface WakeDecisionInput {
  readonly candidates: readonly RecallCandidate[]
  /** Paths already handed to this sidecar lifetime. */
  readonly offered: ReadonlySet<string>
  /** The authoritative surfaced ledger of the main session. */
  readonly surfaced: ReadonlySet<string>
  /** `memory.recall.max_items`. */
  readonly maxItems: number
  readonly cooldown: Pick<AcceptedNudgeCooldown, "exhausted">
}

/**
 * The local gate: no model turn without something new to judge. Freshness is decided before the
 * cooldown so a throttled session still reports honestly that nothing new arrived, and a fresh
 * candidate that hits the cooldown stays un-offered - it wakes the sidecar once the window slides.
 */
export function decideWake(input: WakeDecisionInput): WakeDecision {
  if (input.maxItems <= 0) return { wake: false, reason: "max_items_zero" }
  if (input.candidates.length === 0) return { wake: false, reason: "no_candidates" }
  const fresh: RecallCandidate[] = []
  const seen = new Set<string>()
  for (const candidate of input.candidates) {
    const { path } = candidate
    if (seen.has(path) || input.offered.has(path) || input.surfaced.has(path) || isSystemMemoryPath(path)) continue
    seen.add(path)
    fresh.push(candidate)
  }
  if (fresh.length === 0) return { wake: false, reason: "no_new_candidate" }
  if (input.cooldown.exhausted()) return { wake: false, reason: "cooldown" }
  return { wake: true, candidates: fresh }
}

/** `system/` memories are never nudge-eligible (the nudge tool rejects them), so they never wake either. */
export function isSystemMemoryPath(path: string): boolean {
  return path === "system/" || path.startsWith("system/")
}

export interface BackoffBand {
  readonly minMs?: number
  readonly maxMs?: number
}

/**
 * Delay before the sidecar may be recreated after its `attempt`-th consecutive child failure
 * (0-based): the band doubles per attempt up to the cap, and jitter keeps between half and all of
 * it so many sessions failing together do not retry in lockstep. The floor always wins over jitter.
 */
export function backoffDelayMs(attempt: number, random: () => number = Math.random, band: BackoffBand = {}): number {
  const minMs = band.minMs ?? KIBITZER_BACKOFF_MIN_MS
  const maxMs = band.maxMs ?? KIBITZER_BACKOFF_MAX_MS
  const cap = Math.min(maxMs, minMs * 2 ** Math.max(0, attempt))
  const jittered = cap * (0.5 + 0.5 * clampUnit(random()))
  return Math.round(Math.min(maxMs, Math.max(minMs, jittered)))
}

function clampUnit(value: number): number {
  return Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : 0.5
}
