/**
 * Narrowing for values that arrive from outside the panel: host event contexts, git output, the
 * shared usage cache, credential files on disk.
 *
 * These live in one place because the same one-line guard had quietly grown six copies across the
 * component, and copies drift: one of them had stopped excluding arrays. Everything here is total
 * - it answers `undefined` rather than throwing - because the caller is always a render path or a
 * poll that has to survive a payload it does not recognise.
 */

export function isRecord(value: unknown): value is Record<PropertyKey, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

export function asRecord(value: unknown): Record<PropertyKey, unknown> | undefined {
  return isRecord(value) ? value : undefined
}

export function asArray(value: unknown): readonly unknown[] {
  return Array.isArray(value) ? value : []
}

/** A number worth doing arithmetic on: NaN and Infinity are not values a row can show. */
export function finiteNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined
}

/** A string worth printing; an empty one is the same as absent for every row in this column. */
export function nonEmptyString(value: unknown): string | undefined {
  return typeof value === "string" && value !== "" ? value : undefined
}

/**
 * `{}` when the value is absent, so an optional field can be spread into a literal without being
 * widened to `T | undefined`. The computed key needs the one cast in this file.
 */
export function optional<K extends PropertyKey, V>(key: K, value: V | undefined): Partial<Record<K, V>> {
  return value === undefined ? {} : ({ [key]: value } as Record<K, V>)
}
