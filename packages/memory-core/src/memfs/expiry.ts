/**
 * The `expires` frontmatter key: the instant after which a memory file is no longer projected (#11450).
 *
 * Accepted values are ISO 8601 with an unambiguous instant:
 * - a date (`2026-10-28`): the start of that UTC day;
 * - a datetime with `Z` or a numeric offset (`2026-10-27T06:33Z`, `2026-10-27T15:33:00+09:00`).
 *
 * Anything else (an offset-less datetime, which means a different instant on each device; free text; an impossible
 * calendar date) reads as "no expiry", so a malformed value never hides content.
 */

import { decodeScalarSource } from "./frontmatter-scalar"
import type { MemoryFrontmatter } from "./frontmatter"

const EXPIRY_RE = /^(\d{4}-\d{2}-\d{2})(?:T([01]\d|2[0-3]):[0-5]\d(?::[0-5]\d(?:\.\d{1,9})?)?(Z|[+-](?:[01]\d|2[0-3]):[0-5]\d))?$/

/** The instant (epoch ms) the file stops being projected, or `undefined` when it declares no readable expiry. */
export function memoryExpiresAtMs(frontmatter: MemoryFrontmatter): number | undefined {
  const raw = frontmatter.extra?.expires
  return raw === undefined ? undefined : parseExpiryInstant(decodeScalarSource(raw.trim()))
}

/** A file is expired from its instant on: at `expiresAtMs` itself it is no longer projected. */
export function isMemoryExpired(expiresAtMs: number | undefined, asOfMs: number): boolean {
  return expiresAtMs !== undefined && asOfMs >= expiresAtMs
}

function parseExpiryInstant(value: string): number | undefined {
  const match = EXPIRY_RE.exec(value)
  const date = match?.[1]
  if (date === undefined) return undefined
  // Date.parse rolls an impossible day over (Feb 30 -> Mar 2) on some engines, so the date must read back unchanged.
  const day = Date.parse(`${date}T00:00Z`)
  if (Number.isNaN(day) || new Date(day).toISOString().slice(0, 10) !== date) return undefined
  const ms = match?.[2] === undefined ? day : Date.parse(value)
  return Number.isNaN(ms) ? undefined : ms
}
