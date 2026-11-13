/**
 * OmO Changelog Backfill
 *
 * Pure, deterministic functions for transforming release bodies into changelog entries.
 * All inputs and outputs are immutable; stamping and extraction are idempotent.
 * No live GitHub fetch; all data flows through fixtures.
 *
 * Modules:
 * - changelog-marker: Idempotent marker stamping/extraction
 * - changelog-parse: Deterministic parsing and normalization
 * - changelog-validate: Fail-closed validation
 * - changelog-transform: Pure release→entry transformation
 * - changelog-audit: Fixture reporting
 */

export { stampBackfillMarker, extractBackfillMarker, getBackfillMarkerPattern } from "./changelog-marker"
export { normalizeHeading, parseVersion, parseDate } from "./changelog-parse"
export { validateReleaseRequirements, type Release, type ValidationError } from "./changelog-validate"
export { transformReleaseToEntry, transformReleases, type ChangelogEntry } from "./changelog-transform"
export { auditFixtureMissingReleases } from "./changelog-audit"
