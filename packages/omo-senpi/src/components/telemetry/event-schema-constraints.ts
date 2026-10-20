import type { OmoNativeEventName, OmoNativePropertySchema } from "./event-schemas"

/**
 * The constraints sidecar of the telemetry schema artifact (plan D-I): every string property gets a
 * closed value list or an anchored pattern, every number gets bounds, and every event declares which
 * attributes are required. `event-schemas.ts` stays the PostHog allowlist; this file adds what the
 * collector enforces on the wire. The artifact generator fails on any string or number this file does
 * not cover, so a new property cannot ship without a constraint. Every pattern here is one of the
 * collector registry's named safe shapes (artifact.schema.json `$defs.safePattern`), byte exact; a
 * value that fits none of them must be an enum or a bounded number instead.
 */

export type PropertyConstraint = {
  readonly values?: readonly string[]
  readonly pattern?: string
  readonly integer?: boolean
  readonly min?: number
  readonly max?: number
}

/**
 * Every version the engine emits or declares: MAJOR.MINOR.PATCH with at most one -alpha.N, -beta.N, -rc.N or -dfa.N, a
 * desktop -nightly.YYYYMMDD.N / -preview.YYYYMMDD.N, or a digits-only build counter -N, every numeric part bounded; no
 * build metadata and no free suffix (a hostname-suffixed dev build must not reach the wire). Byte-identical to the collector's final `semver` safe shape; the
 * vendored artifact.schema.json still carries the older, wider one until it is re-pinned.
 */
export const VERSION_PATTERN =
  "^[0-9]{1,6}\\.[0-9]{1,6}\\.[0-9]{1,6}(-(alpha|beta|rc|dfa)\\.[0-9]{1,6}|-(nightly|preview)\\.[0-9]{8}\\.[0-9]{1,6}|-[0-9]{1,6})?$"
/** The collector's `os_version` safe shape: the bare dotted release, no kernel or build suffix. */
export const OS_VERSION_PATTERN = "^[0-9]{1,6}(\\.[0-9]{1,6}){1,3}$"
const OS_RELEASE_PREFIX = /^([0-9]{1,6}(?:\.[0-9]{1,6}){1,3})(?:$|[^0-9.])/

/**
 * The bare dotted release of an OS release string (`26.4.1 (25E253)` -> `26.4.1`, `6.8.0-45-generic`
 * -> `6.8.0`): the suffix after the numeric prefix is stripped. Undefined when the value does not
 * start with such a prefix, so the caller omits it instead of sending it.
 */
export function bareOsVersion(release: string): string | undefined {
  return OS_RELEASE_PREFIX.exec(release)?.[1]
}
export const SESSION_ID_PATTERN = "^[0-9a-f]{64}$"
export const INSTALL_HASH_PATTERN = "^[0-9a-f]{64}$"
export const INSTANCE_ID_PATTERN = "^[0-9a-f]{32}$"
export const UUID_PATTERN = "^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$"
export const DAY_UTC_PATTERN = "^[0-9]{4}-[0-9]{2}-[0-9]{2}$"
export const COMBO_FINGERPRINT_PATTERN = "^[0-9a-f]{16}$"
/** The random per-run session_summary epoch: 8 random bytes as hex, the collector's `hex16` safe shape. */
export const SUMMARY_EPOCH_PATTERN = "^[0-9a-f]{16}$"

/** Events with no session by design; every other event requires `session.id`. */
export const SESSIONLESS_EVENTS: ReadonlySet<string> = new Set(["process_crashed", "forget_request", "client_dropped"])

/** Events whose every attribute is required: a turn row is meaningless without any of its fields. */
const FULLY_REQUIRED_EVENTS: ReadonlySet<string> = new Set(["turn_completed"])

const TOKENS = { min: 0, max: 1e12 } as const
const COST_USD = { min: 0, max: 1e6 } as const
const COST_1E4 = { integer: true, min: 0, max: 1e10 } as const
const TURN_INDEX = { integer: true, min: 0, max: 1e7 } as const
const DURATION = { min: 0, max: 1e10 } as const
const COUNT = { min: 0, max: 1e9 } as const
const INTEGER_COUNT = { integer: true, ...COUNT } as const
const RATE = { min: 0, max: 1 } as const
// Process exit codes: POSIX 0..255 and signed Windows NTSTATUS values both fit.
const EXIT_CODE = { integer: true, min: -2_147_483_648, max: 4_294_967_295 } as const
// Every real UTC offset, UTC-12:00 through UTC+14:00.
const UTC_OFFSET_MINUTES = { integer: true, min: -720, max: 840 } as const
// The rung of a builtin fallback chain a category resolved to; chains are a handful of rungs long.
const CHAIN_DEPTH = { integer: true, min: 0, max: 99 } as const

const STRING_CONSTRAINTS: Readonly<Record<string, PropertyConstraint>> = {
  $session_id: { pattern: SESSION_ID_PATTERN },
  day_utc: { pattern: DAY_UTC_PATTERN },
  combo_fingerprint: { pattern: COMBO_FINGERPRINT_PATTERN },
  summary_epoch: { pattern: SUMMARY_EPOCH_PATTERN },
  crashed_bun_version: { pattern: VERSION_PATTERN },
  crashed_engine_version: { pattern: VERSION_PATTERN },
  crashed_omo_version: { pattern: VERSION_PATTERN },
}

/** Bounds for one numeric property, decided by what it measures; unknown names are counts. */
export function numberConstraint(property: string): PropertyConstraint {
  if (property === "cost_1e4") return COST_1E4
  if (property === "sample_rate") return RATE
  if (property === "exit_code") return EXIT_CODE
  if (property === "utc_offset_minutes") return UTC_OFFSET_MINUTES
  if (/^cat_[a-z_]+_depth$/.test(property)) return CHAIN_DEPTH
  if (/^wave_size_/.test(property) || property === "custom_provider_count") return INTEGER_COUNT
  if (property === "turn_index" || property === "first_turn_index" || property === "last_turn_index") return TURN_INDEX
  if (/(?:^|_)cost_usd$/.test(property)) return COST_USD
  if (/_tokens(?:_|$)/.test(property)) return TOKENS
  if (/(?:^|_)ms(?:_|$)/.test(property)) return DURATION
  return COUNT
}

/**
 * The constraint for one property of one event: the schema's own closed values when it has them,
 * else the pattern table; numbers get bounds. Undefined means the property has no constraint, which
 * the artifact generator turns into a hard failure.
 */
export function propertyConstraint(
  property: string,
  schema: OmoNativePropertySchema,
): PropertyConstraint | undefined {
  if (schema.type === "boolean") return {}
  if (schema.type === "number") return numberConstraint(property)
  if (schema.values !== undefined) return { values: schema.values }
  return STRING_CONSTRAINTS[property]
}

export function isPropertyRequired(event: OmoNativeEventName | string, property: string): boolean {
  if (FULLY_REQUIRED_EVENTS.has(event)) return true
  return property === "$session_id" && !SESSIONLESS_EVENTS.has(event)
}
