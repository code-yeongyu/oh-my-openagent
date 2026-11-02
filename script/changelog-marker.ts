/**
 * Backfill marker operations.
 *
 * Handles idempotent stamping and extraction of version markers in release bodies.
 * These markers enable deterministic, fail-closed validation and prevent re-processing.
 */

const BACKFILL_MARKER_PATTERN = /<!-- omo-backfill-marker: ([\w.-]+) -->/
const BACKFILL_MARKER_TEMPLATE = "<!-- omo-backfill-marker: {VERSION} -->"

/**
 * Stamp a release body with the backfill marker (version anchor).
 *
 * Idempotent: if the marker already exists with the same version, returns unchanged.
 * Otherwise, appends the marker at the end.
 *
 * @param body Release body text
 * @param version Version string (e.g. "5.0.0-beta.3")
 * @returns Body with marker stamped (or already present)
 */
export function stampBackfillMarker(body: string, version: string): string {
  if (!body || typeof body !== "string") return ""
  if (!version || typeof version !== "string") return body

  const match = body.match(BACKFILL_MARKER_PATTERN)
  if (match && match[1] === version) {
    // Already stamped with this version
    return body
  }

  // Append marker at end, with blank line separator if needed
  const trimmed = body.trimEnd()
  const marker = BACKFILL_MARKER_TEMPLATE.replace("{VERSION}", version)
  return `${trimmed}\n\n${marker}`
}

/**
 * Extract the backfill marker from a release body.
 *
 * @param body Release body text
 * @returns { marked: true/false, version: extracted version or null }
 */
export function extractBackfillMarker(body: string): { marked: boolean; version: string | null } {
  if (!body || typeof body !== "string") return { marked: false, version: null }

  const match = body.match(BACKFILL_MARKER_PATTERN)
  if (!match) return { marked: false, version: null }

  return { marked: true, version: match[1] ?? null }
}

/**
 * Get the marker pattern for regex matching.
 * Exported for audit and advanced uses.
 */
export function getBackfillMarkerPattern(): RegExp {
  return BACKFILL_MARKER_PATTERN
}
