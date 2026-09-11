# OmO Changelog Backfill Transformer Slice 1

## Objective
Implement deterministic pure backfill transformer + tests using fixture release bodies (no live GitHub fetch in tests), with stamp/extract helpers fitting the existing release-changelog pattern.

## Evidence Path
`/Users/yeongyu/.omo/evidence/ulw/01a08f13-2a06-710e-a4e0-3395394e04de/G001-implement-and-ship-the-ideal-changel/a0/omo-backfill.txt`

## Implementation Plan

### 1. Core Transformer Module (Pure Function)
- File: `script/changelog-backfill.ts`
- Exports:
  - `transformReleaseToEntry(release: Release): ChangelogEntry | null` — pure function
  - `stampBackfillMarker(body: string): string` — idempotent marker injection
  - `extractBackfillMarker(body: string): { marked: boolean; version: string | null }` — marker extraction
  - `normalizeHeading(heading: string): string` — deterministic heading normalization
  - `validateReleaseRequirements(release: Release): ValidationError[]` — fail-closed validation

- Types:
  - `Release`: { tagName: string; publishedAt: string | null; body: string; isPrerelease: boolean }
  - `ChangelogEntry`: { version: string; date: string; content: string; marked: boolean }
  - `ValidationError`: { code: string; message: string; field: string }

### 2. Test Suite with Fixtures
- File: `script/changelog-backfill.test.ts`
- Fixture structure: `.omo/fixtures/releases.json`
  - Sample: 51 releases (beta.1 through beta.51)
  - Include: beta.27 and beta.41 as **missing** entries (absent from fixture, demonstrate gap)
  - Format: Array<{ tagName, publishedAt, body, isPrerelease }>
  
- Test cases:
  1. RED: Backfill marker missing → validation fails (fail-closed)
  2. RED: Date not UTC → rejected
  3. GREEN: Valid release with marker → transformed
  4. GREEN: Deterministic heading normalization (same input = same output)
  5. GREEN: Raw body content preserved (no truncation/rewrite)
  6. GREEN: Idempotent stamping (stamp twice = same)
  7. GREEN: Missing releases reported in fixture audit

### 3. Fixture Release Manifest
- File: `.omo/fixtures/releases.json`
- 51 entries with realistic v5.0.0-beta.* tags
- Stamp each body with backfill marker
- Include publishedAt in UTC (ISO 8601)
- Note: beta.27, beta.41 deliberately omitted (show gap in output)

### 4. Integration Tests (No Live Fetch)
- Verify transformer works with heterogeneous release bodies
- Validate determinism: same inputs always produce same outputs
- Confirm ledger remains separate (non-versioned)
- Validate marker prevents re-processing

### 5. Verification
- Diagnostics on modified files
- Test RED → GREEN cycle
- Evidence file with exact commands and counts

## Scope Boundary
- **IN**: Deterministic transformer, fixtures, tests, stamp/extract helpers
- **OUT**: Live GitHub fetch, full 51-release backfill into CHANGELOG.md, merge/publish
- Do NOT: run `npm install`, use hooks, attempt live rewrite
