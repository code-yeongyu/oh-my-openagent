import type { ReflectionRequest } from "./machine"

// Circuit breaker for automatic reflection (#8304). A deterministic failure (missing model, boot
// crash, refused sandbox) repeats identically on every retry, so three in a row park the identity;
// a transient failure (rate limit, provider outage) gets twice the room before parking. While
// parked, one half-open probe per interval keeps self-healing possible without hammering the host.
export const REFLECTION_PARK_NON_RETRYABLE_STREAK = 3
export const REFLECTION_PARK_RETRYABLE_STREAK = 6
export const REFLECTION_PARK_PROBE_INTERVAL_MS = 6 * 60 * 60_000
export const REFLECTION_PARK_DETAIL_MAX_CHARS = 512

export interface ReflectionFailureSignal {
  readonly fingerprint: string
  readonly retryable: boolean
  readonly reason?: string
  readonly detail?: string
}

export interface ReflectionParkFailure extends ReflectionFailureSignal {
  readonly runId: string
  readonly at: string
}

export interface ReflectionParkState {
  readonly version: 1
  readonly streak: number
  readonly firstFailureAt?: string
  readonly lastFailure?: ReflectionParkFailure
  readonly parkedAt?: string
  readonly lastProbeAt?: string
}

export type ReflectionParkGate =
  | { readonly kind: "open" }
  | { readonly kind: "probe" }
  | { readonly kind: "parked"; readonly nextProbeAt: string }

export function emptyReflectionParkState(): ReflectionParkState {
  return { version: 1, streak: 0 }
}

export function isReflectionParked(state: ReflectionParkState): boolean {
  return state.parkedAt !== undefined
}

export function isAutomaticReflectionRequest(request: ReflectionRequest): boolean {
  if (request.trigger === "manual") return false
  if (request.trigger === "dream") return request.origin !== "manual"
  return true
}

export function applyReflectionParkFailure(
  state: ReflectionParkState,
  failure: ReflectionParkFailure,
): ReflectionParkState {
  const streak = state.streak + 1
  const threshold = failure.retryable ? REFLECTION_PARK_RETRYABLE_STREAK : REFLECTION_PARK_NON_RETRYABLE_STREAK
  const parkedAt = state.parkedAt ?? (streak >= threshold ? failure.at : undefined)
  const detail = failure.detail?.slice(0, REFLECTION_PARK_DETAIL_MAX_CHARS)
  return {
    version: 1,
    streak,
    firstFailureAt: state.firstFailureAt ?? failure.at,
    lastFailure: {
      runId: failure.runId,
      at: failure.at,
      fingerprint: failure.fingerprint,
      retryable: failure.retryable,
      ...(failure.reason === undefined ? {} : { reason: failure.reason }),
      ...(detail === undefined ? {} : { detail }),
    },
    ...(parkedAt === undefined ? {} : { parkedAt }),
    ...(state.lastProbeAt === undefined ? {} : { lastProbeAt: state.lastProbeAt }),
  }
}

export function clearReflectionPark(): ReflectionParkState {
  return emptyReflectionParkState()
}

export function gateReflectionRequest(
  state: ReflectionParkState,
  request: ReflectionRequest,
  now: string,
): ReflectionParkGate {
  if (state.parkedAt === undefined || !isAutomaticReflectionRequest(request)) return { kind: "open" }
  const nextProbeAt = Date.parse(state.lastProbeAt ?? state.parkedAt) + REFLECTION_PARK_PROBE_INTERVAL_MS
  if (Date.parse(now) >= nextProbeAt) return { kind: "probe" }
  return { kind: "parked", nextProbeAt: new Date(nextProbeAt).toISOString() }
}

export function markReflectionProbe(state: ReflectionParkState, now: string): ReflectionParkState {
  return { ...state, lastProbeAt: now }
}

/** A persisted park.json that this version cannot read: truncated, foreign, or hand-edited. */
export class ReflectionParkStateError extends Error {
  override readonly name = "ReflectionParkStateError"
}

export function isUnreadableReflectionParkState(error: unknown): boolean {
  return error instanceof ReflectionParkStateError || error instanceof SyntaxError
}

export function parseReflectionParkState(value: unknown): ReflectionParkState {
  if (!isRecord(value) || value.version !== 1) throw new ReflectionParkStateError("Invalid reflection park state")
  const streak = value.streak
  if (typeof streak !== "number" || !Number.isInteger(streak) || streak < 0) {
    throw new ReflectionParkStateError("Invalid reflection park streak")
  }
  const firstFailureAt = optionalTimestamp(value.firstFailureAt, "firstFailureAt")
  const parkedAt = optionalTimestamp(value.parkedAt, "parkedAt")
  const lastProbeAt = optionalTimestamp(value.lastProbeAt, "lastProbeAt")
  const lastFailure = value.lastFailure === undefined ? undefined : parseParkFailure(value.lastFailure)
  return {
    version: 1,
    streak,
    ...(firstFailureAt === undefined ? {} : { firstFailureAt }),
    ...(lastFailure === undefined ? {} : { lastFailure }),
    ...(parkedAt === undefined ? {} : { parkedAt }),
    ...(lastProbeAt === undefined ? {} : { lastProbeAt }),
  }
}

function parseParkFailure(value: unknown): ReflectionParkFailure {
  if (!isRecord(value)) throw new ReflectionParkStateError("Invalid reflection park failure")
  const { runId, at, fingerprint, retryable, reason, detail } = value
  if (typeof runId !== "string" || typeof fingerprint !== "string" || typeof retryable !== "boolean") {
    throw new ReflectionParkStateError("Invalid reflection park failure")
  }
  const timestamp = optionalTimestamp(at, "at")
  if (timestamp === undefined) throw new ReflectionParkStateError("Invalid reflection park failure timestamp")
  if (reason !== undefined && typeof reason !== "string") throw new ReflectionParkStateError("Invalid reflection park failure reason")
  if (detail !== undefined && typeof detail !== "string") throw new ReflectionParkStateError("Invalid reflection park failure detail")
  return {
    runId,
    at: timestamp,
    fingerprint,
    retryable,
    ...(reason === undefined ? {} : { reason }),
    ...(detail === undefined ? {} : { detail }),
  }
}

function optionalTimestamp(value: unknown, field: string): string | undefined {
  if (value === undefined) return undefined
  if (typeof value !== "string" || Number.isNaN(Date.parse(value))) {
    throw new ReflectionParkStateError(`Invalid reflection park ${field}`)
  }
  return value
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
}
