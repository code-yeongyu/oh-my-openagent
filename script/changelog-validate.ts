/**
 * Release validation for changelog backfill.
 *
 * Fail-closed validation: any error means rejection (no exception, returns error array).
 * Validators check all requirements before transformation is attempted.
 */

import { extractBackfillMarker } from "./changelog-marker"
import { parseVersion } from "./changelog-parse"

export interface Release {
  tagName: string
  publishedAt: string | null
  body: string | null
  isPrerelease: boolean
}

export interface ValidationError {
  code: string
  message: string
  field: string
}

/**
 * Validate a release for backfill eligibility.
 *
 * Fail-closed validation: a release with ANY error is rejected.
 *
 * Checks:
 * - publishedAt must be a valid UTC ISO 8601 timestamp (not null)
 * - body must be non-empty string
 * - backfill marker must be present
 * - version must parse cleanly from tagName
 *
 * @param release Release to validate
 * @returns Array of validation errors (empty = valid)
 */
export function validateReleaseRequirements(release: Release): ValidationError[] {
  const errors: ValidationError[] = []

  // Check tagName exists and parses
  if (!release.tagName || typeof release.tagName !== "string") {
    errors.push({
      code: "INVALID_TAG_NAME",
      message: "tagName must be a non-empty string",
      field: "tagName",
    })
  } else {
    const version = parseVersion(release.tagName)
    if (!version) {
      errors.push({
        code: "INVALID_VERSION_PARSE",
        message: `Failed to parse version from tag: ${release.tagName}`,
        field: "tagName",
      })
    }
  }

  // Check publishedAt is UTC ISO 8601 (not null)
  if (!release.publishedAt || typeof release.publishedAt !== "string") {
    errors.push({
      code: "MISSING_PUBLISHED_AT",
      message: "publishedAt must be a non-empty UTC ISO 8601 timestamp",
      field: "publishedAt",
    })
  } else {
    // Validate UTC ISO 8601 pattern (basic check)
    if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/.test(release.publishedAt)) {
      errors.push({
        code: "INVALID_TIMESTAMP_FORMAT",
        message: `publishedAt must be UTC ISO 8601 (e.g. 2026-08-10T10:16:58Z), got: ${release.publishedAt}`,
        field: "publishedAt",
      })
    }
  }

  // Check body exists
  if (!release.body || typeof release.body !== "string") {
    errors.push({
      code: "MISSING_BODY",
      message: "body must be a non-empty string",
      field: "body",
    })
  } else {
    // Check backfill marker present
    const { marked } = extractBackfillMarker(release.body)
    if (!marked) {
      errors.push({
        code: "MISSING_BACKFILL_MARKER",
        message: "body must contain backfill marker (<!-- omo-backfill-marker: version -->)",
        field: "body",
      })
    }
  }

  return errors
}
