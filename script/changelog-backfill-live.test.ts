#!/usr/bin/env bun
/// <reference types="bun-types" />

import { describe, expect, test } from "bun:test"
import {
  validateManifest,
  releaseToEntry,
  generateBackfillSection,
  extractUnreleasedSection,
  backfillChangelog,
  type LiveRelease,
  type LiveManifest,
} from "./changelog-backfill-live"

// ==============================================================================
// Fixtures
// ==============================================================================

const minimalManifest: LiveManifest = {
  fetchedAt: "2026-09-11T11:28:45.268Z",
  count: 51,
  missing: [27, 41],
  releaseTags: Array.from({ length: 51 }, (_, i) => {
    const num = i + 1
    if (num === 27 || num === 41) return null
    return `v5.0.0-beta.${num}`
  }).filter((x): x is string => x !== null),
  releases: Array.from({ length: 51 }, (_, i) => {
    const num = i + 1
    const day = (9 + Math.floor(i / 15)).toString().padStart(2, "0")
    const hour = (i % 24).toString().padStart(2, "0")
    const minute = ((i * 7) % 60).toString().padStart(2, "0")
    const second = ((i * 13) % 60).toString().padStart(2, "0")
    return {
      tagName: `v5.0.0-beta.${num === 27 || num === 41 ? num + 1 : num}`,
      publishedAt: `2026-08-${day}T${hour}:${minute}:${second}Z`,
      body: `## Fixed\n\n- Change ${num}`,
      isPrerelease: true,
    }
  }),
}

const validReleaseEntry: LiveRelease = {
  tagName: "v5.0.0-beta.1",
  publishedAt: "2026-08-09T23:00:35Z",
  body: "## Fixed\n\n- Memory crash",
  isPrerelease: true,
}

const unreleasedChangelog = `# Changelog

## [Unreleased]

### Added

- New pending feature

### Changed

- Breaking change note
`

// ==============================================================================
// validateManifest
// ==============================================================================

describe("validateManifest", () => {
  test("#given valid manifest #when validated #then passes", () => {
    const result = validateManifest(minimalManifest)
    expect(result.valid).toBe(true)
    expect(result.errors.length).toBe(0)
  })

  test("#given manifest with wrong count #when validated #then rejects", () => {
    const bad = { ...minimalManifest, count: 50 }
    const result = validateManifest(bad)
    expect(result.valid).toBe(false)
    expect(result.errors.some((e) => e.includes("count must be 51"))).toBe(true)
  })

  test("#given manifest with wrong missing tags #when validated #then rejects", () => {
    const bad = { ...minimalManifest, missing: [26, 40] }
    const result = validateManifest(bad)
    expect(result.valid).toBe(false)
    expect(result.errors.some((e) => e.includes("missing must be [27, 41]"))).toBe(true)
  })

  test("#given manifest with bad fetchedAt #when validated #then rejects", () => {
    const bad = { ...minimalManifest, fetchedAt: "2026-09-11" }
    const result = validateManifest(bad)
    expect(result.valid).toBe(false)
    expect(result.errors.some((e) => e.includes("fetchedAt"))).toBe(true)
  })

  test("#given null manifest #when validated #then rejects", () => {
    const result = validateManifest(null)
    expect(result.valid).toBe(false)
    expect(result.errors.length > 0).toBe(true)
  })
})

// ==============================================================================
// releaseToEntry
// ==============================================================================

describe("releaseToEntry", () => {
  test("#given release with v-prefix #when converted #then prefix is removed", () => {
    const entry = releaseToEntry(validReleaseEntry)
    expect(entry).toContain("## [5.0.0-beta.1]")
  })

  test("#given release published 2026-08-09 #when converted #then date is formatted YYYY-MM-DD", () => {
    const entry = releaseToEntry(validReleaseEntry)
    expect(entry).toContain("2026-08-09")
  })

  test("#given release body with trailing newlines #when converted #then normalized", () => {
    const release = { ...validReleaseEntry, body: "## Fixed\n\n- Change\n\n\n" }
    const entry = releaseToEntry(release)
    expect(entry).not.toContain("\n\n\n")
  })

  test("#given release body #when converted #then body is included after heading", () => {
    const entry = releaseToEntry(validReleaseEntry)
    expect(entry).toContain("Memory crash")
  })
})

// ==============================================================================
// generateBackfillSection
// ==============================================================================

describe("generateBackfillSection", () => {
  test("#given list of releases #when section generated #then joined with double newline", () => {
    const releases = minimalManifest.releases
    const section = generateBackfillSection(releases)
    expect(section).toContain("5.0.0-beta.1")
    expect(section).toContain("5.0.0-beta.2")
    expect(section).toContain("2026-08-09")
    expect(section).toContain("2026-08-10")
  })

  test("#given single release #when section generated #then formatted correctly", () => {
    const section = generateBackfillSection([validReleaseEntry])
    expect(section).toContain("## [5.0.0-beta.1]")
    expect(section).toContain("- Memory crash")
  })
})

// ==============================================================================
// extractUnreleasedSection
// ==============================================================================

describe("extractUnreleasedSection", () => {
  test("#given changelog with Unreleased and versioned sections #when extracted #then returns only Unreleased", () => {
    const full = `${unreleasedChangelog}\n\n## [5.0.0-beta.1] - 2026-08-09\n\n- Old release`
    const unreleased = extractUnreleasedSection(full)
    expect(unreleased).toContain("Unreleased")
    expect(unreleased).not.toContain("5.0.0-beta.1")
  })

  test("#given changelog without versions #when extracted #then returns whole content", () => {
    const unreleased = extractUnreleasedSection(unreleasedChangelog)
    expect(unreleased).toContain("Unreleased")
  })

  test("#given empty string #when extracted #then returns empty", () => {
    const unreleased = extractUnreleasedSection("")
    expect(unreleased).toBe("")
  })
})

// ==============================================================================
// backfillChangelog
// ==============================================================================

describe("backfillChangelog", () => {
  const manifest = "2026-09-11T11:28:45.268Z"
  const backfillSection = "## [5.0.0-beta.1] - 2026-08-09\n\n- Memory crash"

  test("#given clean changelog #when backfilled #then inserts section after Unreleased", () => {
    const result = backfillChangelog(unreleasedChangelog, backfillSection, manifest)
    expect(result.error).toBeUndefined()
    expect(result.changelog).toContain("Unreleased")
    expect(result.changelog).toContain("5.0.0-beta.1")
    expect(result.changelog.indexOf("Unreleased") < result.changelog.indexOf("5.0.0-beta.1")).toBe(true)
  })

  test("#given already-backfilled changelog #when backfilled again #then returns error", () => {
    const marker = `<!-- omo-live-backfill-${manifest} -->`
    const modified = `${unreleasedChangelog}\n\n${marker}\n\nPrevious backfill`
    const result = backfillChangelog(modified, backfillSection, manifest)
    expect(result.error).toContain("already applied")
    expect(result.changelog).toBe(modified)
  })

  test("#given changelog with trailing content #when backfilled #then preserves trailing content", () => {
    const trailing = "\n\n[Unreleased]: https://github.com/...\n[4.14.0]: https://github.com/..."
    const input = unreleasedChangelog + trailing
    const result = backfillChangelog(input, backfillSection, manifest)
    expect(result.error).toBeUndefined()
    expect(result.changelog).toContain(trailing.trim())
  })

  test("#given changelog #when backfilled #then output ends with single newline", () => {
    const result = backfillChangelog(unreleasedChangelog, backfillSection, manifest)
    expect(result.error).toBeUndefined()
    expect(result.changelog.endsWith("\n")).toBe(true)
    expect(result.changelog.endsWith("\n\n")).toBe(false)
  })

  test("#given manifest timestamp #when backfilled twice #then idempotent markers prevent double insert", () => {
    const first = backfillChangelog(unreleasedChangelog, backfillSection, manifest)
    expect(first.error).toBeUndefined()
    const second = backfillChangelog(first.changelog, backfillSection, manifest)
    expect(second.error).toContain("already applied")
  })
})
