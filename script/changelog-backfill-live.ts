#!/usr/bin/env bun
/**
 * Live manifest backfill: transforms actual GitHub release bodies into CHANGELOG entries.
 * 
 * Constraints:
 * - Validates manifest count (51), missing tags (beta.27, beta.41)
 * - Uses UTC ISO 8601 dates
 * - Normalizes headings (duplicate blank lines, trailing whitespace)
 * - Preserves existing Unreleased section (non-version ledger)
 * - Idempotent: tracks via version-specific markers
 * - Under 250 LOC for new logic
 */

export interface LiveRelease {
  tagName: string
  publishedAt: string
  body: string
  isPrerelease: boolean
}

export interface LiveManifest {
  fetchedAt: string
  count: number
  missing: number[]
  releaseTags: string[]
  releases: LiveRelease[]
}

/**
 * Validates manifest structure and content.
 */
export function validateManifest(manifest: unknown): { valid: boolean; errors: string[] } {
  const errors: string[] = []

  if (!manifest || typeof manifest !== "object") {
    errors.push("manifest must be an object")
    return { valid: false, errors }
  }

  const m = manifest as Record<string, unknown>

  if (typeof m.count !== "number" || m.count !== 51) {
    errors.push(`count must be 51, got ${m.count}`)
  }
  if (!Array.isArray(m.missing) || m.missing.length !== 2 || !m.missing.includes(27) || !m.missing.includes(41)) {
    errors.push("missing must be [27, 41]")
  }
  if (!Array.isArray(m.releases)) {
    errors.push("releases must be an array")
  } else if ((m.releases as unknown[]).length !== 51) {
    errors.push(`releases.length must be 51, got ${(m.releases as unknown[]).length}`)
  }
  if (typeof m.fetchedAt !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(m.fetchedAt)) {
    errors.push("fetchedAt must be UTC ISO 8601 with milliseconds")
  }

  return { valid: errors.length === 0, errors }
}

/**
 * Normalizes heading: trim, collapse blank lines, remove trailing whitespace.
 */
function normalizeHeading(text: string): string {
  if (!text) return ""
  return text
    .split("\n")
    .map((line) => line.trimEnd())
    .join("\n")
    .replace(/\n\n+/g, "\n\n")
    .trim()
}

/**
 * Transforms a single release into a changelog section.
 * Format: ## [version] - YYYY-MM-DD followed by normalized body.
 */
export function releaseToEntry(release: LiveRelease): string {
  const date = release.publishedAt.split("T")[0] // Extract YYYY-MM-DD
  const version = release.tagName.replace(/^v/, "")
  const heading = `## [${version}] - ${date}`
  const normalized = normalizeHeading(release.body)
  return `${heading}\n\n${normalized}`
}

/**
 * Generates changelog section from ordered releases (reverse chronological already).
 */
export function generateBackfillSection(releases: LiveRelease[]): string {
  return releases.map((r) => releaseToEntry(r)).join("\n\n")
}

/**
 * Extracts and preserves Unreleased section (everything before first ## [version]).
 * Returns whole changelog if no versioned sections exist.
 */
export function extractUnreleasedSection(changelog: string): string {
  const match = changelog.match(/^([\s\S]*?)(?=^## \[\d)/m)
  // If no match, check if there are ANY versioned headers at all
  if (!match) {
    return changelog.trim() === "" ? "" : changelog
  }
  return match[1].trim()
}

/**
 * Idempotent backfill: inserts backfill section after Unreleased, keyed by manifest timestamp.
 * Returns error on conflict (backfill marker already exists for this manifest).
 */
export function backfillChangelog(changelog: string, backfillSection: string, manifestTimestamp: string): { changelog: string; error?: string } {
  const marker = `<!-- omo-live-backfill-${manifestTimestamp} -->`
  if (changelog.includes(marker)) {
    return { changelog, error: `backfill already applied for manifest ${manifestTimestamp}` }
  }

  const unreleased = extractUnreleasedSection(changelog)
  const rest = changelog.slice(unreleased.length).trim()

  return {
    changelog: `${unreleased.trimEnd()}\n\n${marker}\n\n${backfillSection.trimEnd()}\n\n${rest}`.trim() + "\n",
  }
}
