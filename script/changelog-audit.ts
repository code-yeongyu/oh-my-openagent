/**
 * Fixture audit utilities for changelog backfill.
 *
 * Reporting and analysis functions for release fixtures (no transformations).
 */

import { type Release } from "./changelog-validate"

/**
 * Audit a fixture for missing releases.
 *
 * Identifies releases marked as null (missing publishedAt or body),
 * typically indicators of gaps in the backfill manifest.
 *
 * @param fixture Array of releases from fixture
 * @returns { missingCount: number; missingTags: string[] }
 */
export function auditFixtureMissingReleases(fixture: Release[]): {
  missingCount: number
  missingTags: string[]
} {
  if (!Array.isArray(fixture)) {
    return { missingCount: 0, missingTags: [] }
  }

  const missing = fixture.filter((r) => r.publishedAt === null || r.body === null)
  return {
    missingCount: missing.length,
    missingTags: missing.map((r) => r.tagName),
  }
}
