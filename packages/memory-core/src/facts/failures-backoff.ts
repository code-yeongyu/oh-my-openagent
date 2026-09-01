// Pure failure-streak arithmetic. No IO: the store owns durability, this owns the curve so
// eligibility instants are testable against an injected clock instead of wall time.

import {
  sortFailureRecords,
  type FactsFailureReason,
  type FactsFailureRecord,
} from "./failures-schema"

/** Delay after failure N (1-indexed). A fifth failure parks instead of scheduling. */
const BACKOFF_MS = [60_000, 5 * 60_000, 30 * 60_000, 120 * 60_000] as const

const PARK_AT_STREAK = 5

const DETAIL_MAX_BYTES = 512

/** One queue endpoint the failure applies to; the store maps batches onto these. */
export interface FactsFailureTarget {
  readonly conversationId: string
  readonly endMessageId: string
  readonly endSnapshotLine: number
}

export interface ApplyFailureInput {
  readonly entries: readonly FactsFailureRecord[]
  readonly targets: readonly FactsFailureTarget[]
  readonly failureId: string
  readonly reason: FactsFailureReason
  readonly detail?: string
  readonly now: Date
}

export interface FactsFailureFilter {
  readonly conversationId?: string
  readonly endMessageId?: string
}

function key(conversationId: string, endMessageId: string): string {
  return `${conversationId}\u0000${endMessageId}`
}

function recordKey(record: FactsFailureRecord): string {
  return key(record.conversationId, record.end_message_id)
}

function targetKey(target: FactsFailureTarget): string {
  return key(target.conversationId, target.endMessageId)
}

/** Control characters would corrupt log lines and TUI output; collapse them to spaces. */
function sanitizeDetail(detail: string): string | undefined {
  const flattened = detail.replace(/[\u0000-\u001f\u007f]+/g, " ").trim()
  if (flattened.length === 0) return undefined
  return truncateToBytes(flattened, DETAIL_MAX_BYTES)
}

/** Caps at UTF-8 BYTES without splitting a code point (byte-slicing would emit U+FFFD). */
function truncateToBytes(value: string, maxBytes: number): string {
  if (Buffer.byteLength(value, "utf8") <= maxBytes) return value
  let bytes = 0
  let end = 0
  for (const character of value) {
    const size = Buffer.byteLength(character, "utf8")
    if (bytes + size > maxBytes) break
    bytes += size
    end += character.length
  }
  return value.slice(0, end)
}

function nextRecord(
  previous: FactsFailureRecord | undefined,
  target: FactsFailureTarget,
  input: ApplyFailureInput,
  detail: string | undefined,
): FactsFailureRecord {
  const at = input.now.toISOString()
  // The streak counts CONSECUTIVE terminal failures for this endpoint regardless of reason:
  // a batch that fails four different ways is no healthier than one failing the same way.
  const streak = (previous?.streak ?? 0) + 1
  // Parking is ABSORBING: nothing here can unpark a record (only manual `/facts retry` clears
  // it), because a later failure with a different reason is not evidence the cause was fixed.
  // The streak still grows while parked, so `/facts` can show how long an endpoint has been dead.
  const parks =
    previous?.state === "parked" || input.reason === "payload_entry_oversize" || streak >= PARK_AT_STREAK
  const base: FactsFailureRecord = {
    conversationId: target.conversationId,
    end_message_id: target.endMessageId,
    end_snapshot_line: target.endSnapshotLine,
    state: parks ? "parked" : "backoff",
    streak,
    firstFailureAt: previous?.firstFailureAt ?? at,
    lastFailureAt: at,
    lastReason: input.reason,
    lastFailureId: input.failureId,
    nextEligibleAt: parks ? null : new Date(input.now.getTime() + delayFor(streak)).toISOString(),
  }
  return {
    ...base,
    ...(detail === undefined ? {} : { lastDetail: detail }),
    ...(parks ? { parkedAt: previous?.parkedAt ?? at } : {}),
  }
}

function delayFor(streak: number): number {
  return BACKOFF_MS[Math.min(streak, BACKOFF_MS.length) - 1] ?? 0
}

/**
 * IDEMPOTENT per `failureId`: a target whose record already carries this id is left exactly
 * as-is, so finalize and its crash-recovery replay cannot double-increment one streak.
 */
export function applyFailure(input: ApplyFailureInput): readonly FactsFailureRecord[] {
  const detail = input.detail === undefined ? undefined : sanitizeDetail(input.detail)
  const byKey = new Map(input.entries.map((record) => [recordKey(record), record]))
  for (const target of input.targets) {
    const previous = byKey.get(targetKey(target))
    if (previous?.lastFailureId === input.failureId) continue
    byKey.set(targetKey(target), nextRecord(previous, target, input, detail))
  }
  return sortFailureRecords([...byKey.values()])
}

/** Terminal success: the endpoint's failure history is no longer meaningful. */
export function clearOnSuccess(
  entries: readonly FactsFailureRecord[],
  targets: readonly FactsFailureTarget[],
): readonly FactsFailureRecord[] {
  const cleared = new Set(targets.map((target) => targetKey(target)))
  return entries.filter((record) => !cleared.has(recordKey(record)))
}

/** Manual unpark. An empty filter clears everything; there is no automatic unparking. */
export function clearForRetry(
  entries: readonly FactsFailureRecord[],
  filter: FactsFailureFilter,
): readonly FactsFailureRecord[] {
  return entries.filter((record) => {
    if (filter.conversationId !== undefined && record.conversationId !== filter.conversationId) return true
    if (filter.endMessageId !== undefined && record.end_message_id !== filter.endMessageId) return true
    return false
  })
}

export { type FactsFailureReason, type FactsFailureRecord } from "./failures-schema"
