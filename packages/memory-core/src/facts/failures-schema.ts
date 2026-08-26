// Durable facts failure-streak wire format. The file gates every relaunch decision, so a
// shape this parser cannot vouch for is a HARD error: silently degrading to empty state
// would resurrect the incident where a permanently failing batch relaunched forever.

export const FACTS_FAILURES_VERSION = 1 as const

export const FACTS_FAILURE_REASONS = [
  "quick_category_unavailable",
  "sandbox_unavailable",
  "child_exit",
  "deadline_exceeded",
  "invalid_extraction",
  "memory_write_lock_exhausted",
  "parent_dirty",
  "unknown_liveness",
  "payload_envelope_oversize",
  "payload_entry_oversize",
  "other",
] as const

export type FactsFailureReason = (typeof FACTS_FAILURE_REASONS)[number]

export type FactsFailureState = "backoff" | "parked"

/** One queue endpoint, keyed exactly as the queue keys a batch: (conversationId, end_message_id). */
export interface FactsFailureRecord {
  readonly conversationId: string
  readonly end_message_id: string
  readonly end_snapshot_line: number
  readonly state: FactsFailureState
  readonly streak: number
  readonly firstFailureAt: string
  readonly lastFailureAt: string
  readonly lastReason: FactsFailureReason
  readonly lastDetail?: string
  readonly lastFailureId: string
  readonly nextEligibleAt: string | null
  readonly parkedAt?: string
}

export interface FactsFailuresFile {
  readonly version: typeof FACTS_FAILURES_VERSION
  readonly updatedAt: string
  readonly entries: readonly FactsFailureRecord[]
}

export class FactsFailuresCorruptError extends Error {
  override readonly name = "FactsFailuresCorruptError"

  constructor(reason: string) {
    super(`facts failures file is unusable: ${reason}`)
  }
}

export function emptyFailuresFile(updatedAt: string): FactsFailuresFile {
  return { version: FACTS_FAILURES_VERSION, updatedAt, entries: [] }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
}

function requireNonEmptyString(value: unknown, field: string): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new FactsFailuresCorruptError(`${field} must be a non-empty string`)
  }
  return value
}

/**
 * Strict ISO round-trip. `Date.parse` accepts junk that collapses to NaN, and every
 * `now < nextEligibleAt` comparison against NaN is false - a corrupt instant would make the
 * record permanently launchable, i.e. fail-OPEN.
 */
function requireInstant(value: unknown, field: string): string {
  const text = requireNonEmptyString(value, field)
  const parsed = new Date(text)
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString() !== text) {
    throw new FactsFailuresCorruptError(`${field} must be an ISO-8601 instant`)
  }
  return text
}

function requireNonNegativeInteger(value: unknown, field: string): number {
  if (typeof value !== "number" || !Number.isInteger(value) || value < 0) {
    throw new FactsFailuresCorruptError(`${field} must be a non-negative integer`)
  }
  return value
}

function requireOptionalString(value: unknown, field: string): string | undefined {
  if (value === undefined) return undefined
  return requireNonEmptyString(value, field)
}

function requireReason(value: unknown): FactsFailureReason {
  const candidates: readonly string[] = FACTS_FAILURE_REASONS
  if (typeof value !== "string" || !candidates.includes(value)) {
    throw new FactsFailuresCorruptError(`lastReason "${String(value)}" is not a known reason`)
  }
  return value as FactsFailureReason
}

function requireState(value: unknown): FactsFailureState {
  if (value !== "backoff" && value !== "parked") {
    throw new FactsFailuresCorruptError(`state "${String(value)}" is not backoff or parked`)
  }
  return value
}

function parseRecord(value: unknown): FactsFailureRecord {
  if (!isRecord(value)) throw new FactsFailuresCorruptError("entries must contain objects")
  const state = requireState(value.state)
  const nextEligibleAt =
    value.nextEligibleAt === null ? null : requireInstant(value.nextEligibleAt, "nextEligibleAt")
  const parkedAt = value.parkedAt === undefined ? undefined : requireInstant(value.parkedAt, "parkedAt")
  // The two states are structurally distinct; accepting a half-parked record would let a
  // parked entry silently become eligible again.
  if (state === "parked" && (nextEligibleAt !== null || parkedAt === undefined)) {
    throw new FactsFailuresCorruptError("a parked record needs parkedAt and a null nextEligibleAt")
  }
  if (state === "backoff" && (nextEligibleAt === null || parkedAt !== undefined)) {
    throw new FactsFailuresCorruptError("a backoff record needs nextEligibleAt and no parkedAt")
  }
  const streak = requireNonNegativeInteger(value.streak, "streak")
  if (streak < 1) throw new FactsFailuresCorruptError("streak must be at least 1")
  const record: FactsFailureRecord = {
    conversationId: requireNonEmptyString(value.conversationId, "conversationId"),
    end_message_id: requireNonEmptyString(value.end_message_id, "end_message_id"),
    end_snapshot_line: requireNonNegativeInteger(value.end_snapshot_line, "end_snapshot_line"),
    state,
    streak,
    firstFailureAt: requireInstant(value.firstFailureAt, "firstFailureAt"),
    lastFailureAt: requireInstant(value.lastFailureAt, "lastFailureAt"),
    lastReason: requireReason(value.lastReason),
    lastFailureId: requireNonEmptyString(value.lastFailureId, "lastFailureId"),
    nextEligibleAt,
  }
  const lastDetail = requireOptionalString(value.lastDetail, "lastDetail")
  return {
    ...record,
    ...(lastDetail === undefined ? {} : { lastDetail }),
    ...(parkedAt === undefined ? {} : { parkedAt }),
  }
}

/** FAIL-CLOSED: throws `FactsFailuresCorruptError` rather than degrading to empty state. */
export function parseFailuresFile(raw: string): FactsFailuresFile {
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch (error) {
    throw new FactsFailuresCorruptError(error instanceof Error ? error.message : "unreadable JSON")
  }
  if (!isRecord(parsed)) throw new FactsFailuresCorruptError("root must be an object")
  if (parsed.version !== FACTS_FAILURES_VERSION) {
    throw new FactsFailuresCorruptError(`unsupported version ${String(parsed.version)}`)
  }
  if (!Array.isArray(parsed.entries)) throw new FactsFailuresCorruptError("entries must be an array")
  const entries = parsed.entries.map((row) => parseRecord(row))
  return {
    version: FACTS_FAILURES_VERSION,
    updatedAt: requireInstant(parsed.updatedAt, "updatedAt"),
    entries: sortFailureRecords(entries),
  }
}

/** Deterministic order: conversationId, then snapshot boundary, then endpoint id. */
export function sortFailureRecords(entries: readonly FactsFailureRecord[]): FactsFailureRecord[] {
  return [...entries].sort((left, right) => {
    if (left.conversationId !== right.conversationId) {
      return left.conversationId < right.conversationId ? -1 : 1
    }
    if (left.end_snapshot_line !== right.end_snapshot_line) {
      return left.end_snapshot_line - right.end_snapshot_line
    }
    if (left.end_message_id === right.end_message_id) return 0
    return left.end_message_id < right.end_message_id ? -1 : 1
  })
}

export function renderFailuresFile(entries: readonly FactsFailureRecord[], updatedAt: string): string {
  const file: FactsFailuresFile = {
    version: FACTS_FAILURES_VERSION,
    updatedAt,
    entries: sortFailureRecords(entries),
  }
  return `${JSON.stringify(file, null, 2)}\n`
}
