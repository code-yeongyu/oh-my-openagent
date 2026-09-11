/**
 * Release-to-entry transformation pipeline.
 *
 * Pure, deterministic functions that convert validated releases into changelog entries.
 * Fail-closed: invalid releases are silently skipped, not thrown.
 */

import { validateReleaseRequirements, type Release } from "./changelog-validate"
import { extractBackfillMarker } from "./changelog-marker"
import { parseVersion, parseDate, normalizeHeading } from "./changelog-parse"

export interface ChangelogEntry {
  version: string
  date: string
  content: string
  marked: boolean
  publishedAt: string
}

/**
 * Transform a validated release into a changelog entry.
 *
 * Pure function: same input always produces same output.
 * Returns null if validation fails (fail-closed).
 *
 * @param release Release to transform
 * @returns ChangelogEntry or null if validation fails
 */
export function transformReleaseToEntry(release: Release): ChangelogEntry | null {
  const errors = validateReleaseRequirements(release)
  if (errors.length > 0) {
    return null // Fail-closed: validation error means no entry
  }

  const version = parseVersion(release.tagName)
  const date = parseDate(release.publishedAt!)
  const { marked } = extractBackfillMarker(release.body!)
  const content = normalizeHeading(release.body!)

  return {
    version,
    date,
    content,
    marked,
    publishedAt: release.publishedAt!,
  }
}

/**
 * Batch transform releases into changelog entries.
 *
 * Silently skips releases that fail validation (fail-closed).
 * Preserves order of input releases.
 *
 * @param releases Array of releases
 * @returns Array of successfully transformed entries
 */
export function transformReleases(releases: Release[]): ChangelogEntry[] {
  if (!Array.isArray(releases)) return []

  return releases.flatMap((release) => {
    const entry = transformReleaseToEntry(release)
    return entry ? [entry] : []
  })
}
