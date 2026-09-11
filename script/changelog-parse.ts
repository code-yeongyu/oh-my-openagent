/**
 * Parsing and normalization utilities for changelog data.
 *
 * Deterministic functions that extract structured data from unstructured strings.
 * All operations are pure (no side effects) and deterministic (same input = same output).
 */

/**
 * Deterministic heading normalization.
 *
 * Rules:
 * - Trim leading/trailing whitespace
 * - Preserve internal structure (## Fixed, ### Added, etc.)
 * - Normalize consecutive blank lines to single line
 * - Strip trailing whitespace per line
 *
 * Same input always produces same output (pure function, no randomness).
 */
export function normalizeHeading(heading: string): string {
  if (!heading || typeof heading !== "string") return ""

  const lines = heading.split("\n").map((line) => line.trimEnd())
  const normalized: string[] = []
  let lastBlank = false

  for (const line of lines) {
    const isBlank = line.trim() === ""
    if (isBlank && lastBlank) continue // Skip consecutive blank lines
    normalized.push(line)
    lastBlank = isBlank
  }

  return normalized.join("\n").trim()
}

/**
 * Parse version from tag name (e.g. "v5.0.0-beta.3" -> "5.0.0-beta.3").
 *
 * @param tagName Git tag (e.g. "v5.0.0-beta.3")
 * @returns Version string without leading 'v'
 */
export function parseVersion(tagName: string): string {
  if (!tagName || typeof tagName !== "string") return ""
  return tagName.replace(/^v/, "")
}

/**
 * Parse date from ISO 8601 timestamp to date-only string.
 *
 * @param timestamp ISO 8601 timestamp (e.g. "2026-08-10T10:16:58Z")
 * @returns Date string (e.g. "2026-08-10")
 */
const ISO_UTC_INSTANT = /^(\d{4})-(\d{2})-(\d{2})T\d{2}:\d{2}:\d{2}/

export function parseDate(timestamp: string): string {
  if (!timestamp || typeof timestamp !== "string") return ""
  const match = ISO_UTC_INSTANT.exec(timestamp.trim())
  if (!match) return ""
  const [datePart, year, month, day] = [match[0].slice(0, 10), Number(match[1]), Number(match[2]), Number(match[3])]
  const utc = new Date(Date.UTC(year, month - 1, day))
  if (utc.getUTCFullYear() !== year || utc.getUTCMonth() !== month - 1 || utc.getUTCDate() !== day) return ""
  return datePart
}
