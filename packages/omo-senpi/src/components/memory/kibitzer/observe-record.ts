// One line of `wakes.ndjson`: a settled wake as a closed record - status, cause, model, cursor
// span, tool calls, duration, provider usage, delivered paths - bounded field by field and then as
// a whole, with the failure reason masked (memory-core and senpi secret patterns) and cut before
// any stack frame, so nothing a provider or a child error said verbatim reaches disk.

import { redactKibitzerEventText } from "./events"
import { normalizeGateReason } from "./judge-outcome"
import type { KibitzerWakeOutcome, KibitzerWakeStatus, KibitzerWakeUsage } from "./sidecar-outcome"

/** Hard bound of one serialized `wakes.ndjson` line, newline included. */
export const KIBITZER_WAKE_RECORD_MAX_CHARS = 4096
export const WAKE_MODEL_MAX_CHARS = 128
const WAKE_PATH_MAX_CHARS = 256

/** One line of `wakes.ndjson`. Every string is bounded and masked; the whole line is bounded again. */
export interface KibitzerWakeRecord {
  readonly version: 1
  /** ISO timestamp of the settlement. */
  readonly at: string
  readonly sessionId: string
  readonly wake: number
  readonly generation: number
  readonly status: KibitzerWakeStatus
  readonly cause?: string
  /** Masked, frame-free, at most `GATE_REASON_MAX_CHARS`. */
  readonly reason?: string
  readonly model?: string
  readonly candidateCount: number
  /** Paths of the nudges the parent re-validated and handed to delivery. */
  readonly nudged: readonly string[]
  readonly steered: number
  readonly toolCalls: number
  readonly durationMs: number
  readonly slotWaitMs: number
  readonly cursors?: { readonly first: number; readonly last: number }
  readonly contextTokens?: number
  readonly usage?: KibitzerWakeUsage
  readonly diagnostic: boolean
  /** Present only when the record had to drop its paths and reason to fit the line bound. */
  readonly truncated?: true
}

/**
 * The failure reason as it may be written: cut before the first stack frame (a frame names local
 * paths and code), masked by both secret vocabularies, then bounded like a gate reason.
 */
export function redactKibitzerWakeReason(reason: string | undefined): string | undefined {
  if (reason === undefined) return undefined
  const head = reason.split(/\r?\n\s*at\s+/u, 1)[0] ?? ""
  return normalizeGateReason(redactKibitzerEventText(head))
}

export function kibitzerWakeRecord(outcome: KibitzerWakeOutcome, at: number): KibitzerWakeRecord {
  const reason = redactKibitzerWakeReason(outcome.reason)
  const record: KibitzerWakeRecord = {
    version: 1,
    at: new Date(at).toISOString(),
    sessionId: outcome.sessionId,
    wake: outcome.wake,
    generation: outcome.generation,
    status: outcome.status,
    ...(outcome.cause === undefined ? {} : { cause: outcome.cause }),
    ...(reason === undefined ? {} : { reason }),
    ...(outcome.model === undefined ? {} : { model: capped(redactKibitzerEventText(outcome.model), WAKE_MODEL_MAX_CHARS) }),
    candidateCount: outcome.candidateCount,
    nudged: outcome.nudges.map((nudge) => capped(nudge.path, WAKE_PATH_MAX_CHARS)),
    steered: outcome.steered,
    toolCalls: outcome.toolCalls,
    durationMs: outcome.durationMs,
    slotWaitMs: outcome.slotWaitMs,
    ...(outcome.cursors === undefined ? {} : { cursors: { first: outcome.cursors.first, last: outcome.cursors.last } }),
    ...(outcome.contextTokens === undefined ? {} : { contextTokens: outcome.contextTokens }),
    ...(outcome.usage === undefined ? {} : { usage: { ...outcome.usage } }),
    diagnostic: outcome.diagnostic,
  }
  if (JSON.stringify(record).length < KIBITZER_WAKE_RECORD_MAX_CHARS) return record
  const { reason: _reason, ...bounded } = record
  return { ...bounded, nudged: [], truncated: true }
}

export function capped(text: string, max: number): string {
  return text.length <= max ? text : text.slice(0, max)
}
