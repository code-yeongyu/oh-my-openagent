/// <reference types="bun-types" />

import { describe, expect, test } from "bun:test"
import {
  normalizeHeading,
  stampBackfillMarker,
  extractBackfillMarker,
  parseVersion,
  parseDate,
  validateReleaseRequirements,
  transformReleaseToEntry,
  transformReleases,
  auditFixtureMissingReleases,
  type Release,
} from "./changelog-backfill-index"

// ==============================================================================
// Test Fixtures
// ==============================================================================

const fixtureDir = new URL("../.omo/fixtures/releases.json", import.meta.url)

async function loadFixture(): Promise<Release[]> {
  const text = await Bun.file(fixtureDir).text()
  const data = JSON.parse(text) as { releases: Release[] }
  return data.releases.filter((r) => r.body !== null) // Only valid releases for transformation tests
}

const validReleaseWithMarker: Release = {
  tagName: "v5.0.0-beta.3",
  publishedAt: "2026-08-10T10:16:58Z",
  isPrerelease: true,
  body: "## Fixed\n\n- Memory extension node-load crash\n\n<!-- omo-backfill-marker: v5.0.0-beta.3 -->",
}

const releaseNoMarker: Release = {
  tagName: "v5.0.0-beta.99",
  publishedAt: "2026-08-10T10:16:58Z",
  isPrerelease: true,
  body: "## Fixed\n\n- Some change without marker",
}

const releaseNoPublishedAt: Release = {
  tagName: "v5.0.0-beta.99",
  publishedAt: null,
  isPrerelease: true,
  body: "## Fixed\n\n- Change\n\n<!-- omo-backfill-marker: v5.0.0-beta.99 -->",
}

const releaseBadTimestamp: Release = {
  tagName: "v5.0.0-beta.99",
  publishedAt: "2026-08-10 10:16:58", // Not UTC ISO 8601
  isPrerelease: true,
  body: "## Fixed\n\n- Change\n\n<!-- omo-backfill-marker: v5.0.0-beta.99 -->",
}

// ==============================================================================
// normalizeHeading
// ==============================================================================

describe("normalizeHeading", () => {
  test("#given a heading with structure #when normalized #then whitespace is trimmed and duplicates removed", () => {
    const heading = "## Fixed\n\n- Item 1\n\n\n- Item 2\n  "
    const normalized = normalizeHeading(heading)
    expect(normalized).toBe("## Fixed\n\n- Item 1\n\n- Item 2")
  })

  test("#given empty string #when normalized #then returns empty", () => {
    expect(normalizeHeading("")).toBe("")
  })

  test("#given only whitespace #when normalized #then returns empty", () => {
    expect(normalizeHeading("   \n\n  \n  ")).toBe("")
  })

  test("#given deterministic input #when normalized twice #then same output both times", () => {
    const heading = "## Added\n\n- Feature 1\n- Feature 2"
    const first = normalizeHeading(heading)
    const second = normalizeHeading(heading)
    expect(first).toBe(second)
  })

  test("#given single line #when normalized #then trimmed and returned", () => {
    expect(normalizeHeading("  Single line  ")).toBe("Single line")
  })
})

// ==============================================================================
// stampBackfillMarker
// ==============================================================================

describe("stampBackfillMarker", () => {
  test("#given body without marker #when stamped #then marker is appended", () => {
    const body = "## Fixed\n\n- Change"
    const version = "5.0.0-beta.3"
    const stamped = stampBackfillMarker(body, version)

    expect(stamped).toContain("<!-- omo-backfill-marker: 5.0.0-beta.3 -->")
    expect(stamped).toContain("## Fixed\n\n- Change")
  })

  test("#given body already stamped with same version #when stamped again #then unchanged", () => {
    const version = "5.0.0-beta.3"
    const body = "## Fixed\n\n- Change\n\n<!-- omo-backfill-marker: 5.0.0-beta.3 -->"
    const stamped = stampBackfillMarker(body, version)

    expect(stamped).toBe(body) // Idempotent
  })

  test("#given empty body #when stamped #then returns empty", () => {
    expect(stampBackfillMarker("", "5.0.0-beta.3")).toBe("")
  })

  test("#given empty version #when stamped #then returns body unchanged", () => {
    const body = "## Fixed\n\n- Change"
    expect(stampBackfillMarker(body, "")).toBe(body)
  })

  test("#given stamped body #when extract marker called #then version matches", () => {
    const version = "5.0.0-beta.5"
    const body = "## Added\n\n- New feature"
    const stamped = stampBackfillMarker(body, version)
    const { marked, version: extracted } = extractBackfillMarker(stamped)

    expect(marked).toBe(true)
    expect(extracted).toBe(version)
  })
})

// ==============================================================================
// extractBackfillMarker
// ==============================================================================

describe("extractBackfillMarker", () => {
  test("#given body with marker #when extracted #then marked is true and version matches", () => {
    const body = "## Fixed\n\n- Item\n\n<!-- omo-backfill-marker: 5.0.0-beta.3 -->"
    const { marked, version } = extractBackfillMarker(body)

    expect(marked).toBe(true)
    expect(version).toBe("5.0.0-beta.3")
  })

  test("#given body without marker #when extracted #then marked is false", () => {
    const body = "## Fixed\n\n- Item"
    const { marked, version } = extractBackfillMarker(body)

    expect(marked).toBe(false)
    expect(version).toBeNull()
  })

  test("#given empty body #when extracted #then marked is false", () => {
    const { marked, version } = extractBackfillMarker("")

    expect(marked).toBe(false)
    expect(version).toBeNull()
  })
})

// ==============================================================================
// parseVersion
// ==============================================================================

describe("parseVersion", () => {
  test("#given tag with v prefix #when parsed #then v is removed", () => {
    expect(parseVersion("v5.0.0-beta.3")).toBe("5.0.0-beta.3")
  })

  test("#given tag without v prefix #when parsed #then returned as-is", () => {
    expect(parseVersion("5.0.0-beta.3")).toBe("5.0.0-beta.3")
  })

  test("#given empty string #when parsed #then returns empty", () => {
    expect(parseVersion("")).toBe("")
  })
})

// ==============================================================================
// parseDate
// ==============================================================================

describe("parseDate", () => {
  test("#given ISO 8601 UTC timestamp #when parsed #then date part extracted", () => {
    expect(parseDate("2026-08-10T10:16:58Z")).toBe("2026-08-10")
  })

  test("#given timestamp without T #when parsed #then returns empty", () => {
    expect(parseDate("2026-08-10 10:16:58")).toBe("")
  })

  test("#given impossible calendar date #when parsed #then returns empty", () => {
    expect(parseDate("2026-02-30T10:16:58Z")).toBe("")
  })

  test("#given empty string #when parsed #then returns empty", () => {
    expect(parseDate("")).toBe("")
  })
})

// ==============================================================================
// validateReleaseRequirements
// ==============================================================================

describe("validateReleaseRequirements", () => {
  test("#given valid release with marker #when validated #then no errors", () => {
    const errors = validateReleaseRequirements(validReleaseWithMarker)
    expect(errors).toHaveLength(0)
  })

  test("#given release without marker #when validated #then MISSING_BACKFILL_MARKER error", () => {
    const errors = validateReleaseRequirements(releaseNoMarker)
    expect(errors).toHaveLength(1)
    expect(errors[0]?.code).toBe("MISSING_BACKFILL_MARKER")
  })

  test("#given release with null publishedAt #when validated #then MISSING_PUBLISHED_AT error", () => {
    const errors = validateReleaseRequirements(releaseNoPublishedAt)
    expect(errors).toHaveLength(1)
    expect(errors[0]?.code).toBe("MISSING_PUBLISHED_AT")
  })

  test("#given release with bad timestamp format #when validated #then INVALID_TIMESTAMP_FORMAT error", () => {
    const errors = validateReleaseRequirements(releaseBadTimestamp)
    expect(errors).toHaveLength(1)
    expect(errors[0]?.code).toBe("INVALID_TIMESTAMP_FORMAT")
  })

  test("#given release with null body #when validated #then MISSING_BODY error", () => {
    const release: Release = {
      ...validReleaseWithMarker,
      body: null,
    }
    const errors = validateReleaseRequirements(release)
    expect(errors.length).toBeGreaterThan(0)
    expect(errors.some((e) => e.code === "MISSING_BODY")).toBe(true)
  })

  test("#given release with empty tagName #when validated #then INVALID_TAG_NAME error", () => {
    const release: Release = {
      ...validReleaseWithMarker,
      tagName: "",
    }
    const errors = validateReleaseRequirements(release)
    expect(errors.length).toBeGreaterThan(0)
    expect(errors.some((e) => e.code === "INVALID_TAG_NAME")).toBe(true)
  })
})

// ==============================================================================
// transformReleaseToEntry
// ==============================================================================

describe("transformReleaseToEntry", () => {
  test("#given valid release #when transformed #then entry with version, date, content produced", () => {
    const entry = transformReleaseToEntry(validReleaseWithMarker)

    expect(entry).not.toBeNull()
    expect(entry?.version).toBe("5.0.0-beta.3")
    expect(entry?.date).toBe("2026-08-10")
    expect(entry?.marked).toBe(true)
    expect(entry?.content).toContain("## Fixed")
  })

  test("#given invalid release (no marker) #when transformed #then returns null (fail-closed)", () => {
    const entry = transformReleaseToEntry(releaseNoMarker)
    expect(entry).toBeNull()
  })

  test("#given invalid release (no publishedAt) #when transformed #then returns null (fail-closed)", () => {
    const entry = transformReleaseToEntry(releaseNoPublishedAt)
    expect(entry).toBeNull()
  })

  test("#given deterministic input #when transformed twice #then same output both times", () => {
    const first = transformReleaseToEntry(validReleaseWithMarker)
    const second = transformReleaseToEntry(validReleaseWithMarker)

    expect(first).not.toBeNull()
    expect(second).not.toBeNull()
    if (first && second) {
      expect(first.version).toBe(second.version)
      expect(first.date).toBe(second.date)
      expect(first.content).toBe(second.content)
      expect(first.marked).toBe(second.marked)
    }
  })
})

// ==============================================================================
// transformReleases (batch)
// ==============================================================================

describe("transformReleases", () => {
  test("#given mixed valid and invalid releases #when batch transformed #then only valid entries returned", () => {
    const releases: Release[] = [validReleaseWithMarker, releaseNoMarker, validReleaseWithMarker]
    const entries = transformReleases(releases)

    expect(entries).toHaveLength(2) // Only the two valid ones
    expect(entries[0]?.version).toBe("5.0.0-beta.3")
    expect(entries[1]?.version).toBe("5.0.0-beta.3")
  })

  test("#given empty array #when batch transformed #then returns empty array", () => {
    const entries = transformReleases([])
    expect(entries).toHaveLength(0)
  })

  test("#given non-array input #when batch transformed #then returns empty array", () => {
    const entries = transformReleases(null as any)
    expect(entries).toHaveLength(0)
  })
})

// ==============================================================================
// auditFixtureMissingReleases
// ==============================================================================

describe("auditFixtureMissingReleases", () => {
  test("#given fixture with missing releases #when audited #then missing count and tags reported", async () => {
    const fixture = await loadFixture()
    const all = JSON.parse(await Bun.file(fixtureDir).text()) as { releases: Release[] }

    const audit = auditFixtureMissingReleases(all.releases)

    expect(audit.missingCount).toBeGreaterThan(0)
    expect(audit.missingTags).toContain("v5.0.0-beta.27")
    expect(audit.missingTags).toContain("v5.0.0-beta.41")
  })

  test("#given empty fixture #when audited #then returns zero missing", () => {
    const audit = auditFixtureMissingReleases([])
    expect(audit.missingCount).toBe(0)
    expect(audit.missingTags).toHaveLength(0)
  })
})

// ==============================================================================
// Integration: Fixture-based transformation
// ==============================================================================

describe("Integration: Fixture-based transformation", () => {
  test("#given 51-release fixture #when all valid releases transformed #then entries preserve order and content", async () => {
    const allReleases = JSON.parse(await Bun.file(fixtureDir).text()) as { releases: Release[] }
    const validReleases = allReleases.releases.filter((r) => r.body !== null)

    const entries = transformReleases(validReleases)

    expect(entries.length).toBeGreaterThan(45) // At least 45 of 51 (accounting for the 2 missing)
    expect(entries.every((e) => e.marked)).toBe(true) // All have markers
    expect(entries.every((e) => e.version)).toBe(true) // All have versions
    expect(entries.every((e) => e.date)).toBe(true) // All have dates
  })

  test("#given fixture release #when raw body preserved #then no content loss or truncation", async () => {
    const allReleases = JSON.parse(await Bun.file(fixtureDir).text()) as { releases: Release[] }
    const testRelease = allReleases.releases.find((r) => r.tagName === "v5.0.0-beta.20")

    if (testRelease && testRelease.body) {
      const entry = transformReleaseToEntry(testRelease)
      expect(entry).not.toBeNull()
      if (entry) {
        // Raw body is preserved (minus normalization)
        expect(entry.content).toContain("Parallel composition")
      }
    }
  })

  test("#given fixture #when audited for missing releases #then beta.27 and beta.41 are reported missing", async () => {
    const allReleases = JSON.parse(await Bun.file(fixtureDir).text()) as { releases: Release[] }
    const audit = auditFixtureMissingReleases(allReleases.releases)

    expect(audit.missingCount).toBeGreaterThanOrEqual(2)
    expect(audit.missingTags).toContain("v5.0.0-beta.27")
    expect(audit.missingTags).toContain("v5.0.0-beta.41")
  })
})

// ==============================================================================
// Determinism guarantee
// ==============================================================================

describe("Determinism guarantee", () => {
  test("#given same release input #when transformed 10 times #then output never changes", () => {
    const results = Array.from({ length: 10 }, () => transformReleaseToEntry(validReleaseWithMarker))

    const first = results[0]
    for (let i = 1; i < results.length; i++) {
      expect(results[i]?.version).toBe(first?.version)
      expect(results[i]?.date).toBe(first?.date)
      expect(results[i]?.content).toBe(first?.content)
      expect(results[i]?.marked).toBe(first?.marked)
    }
  })
})

// ==============================================================================
// Idempotency guarantee
// ==============================================================================

describe("Idempotency guarantee", () => {
  test("#given release body #when stamped multiple times #then marker is added once and only once", () => {
    const body = "## Added\n\n- Feature"
    const version = "5.0.0-beta.99"

    const once = stampBackfillMarker(body, version)
    const twice = stampBackfillMarker(once, version)
    const thrice = stampBackfillMarker(twice, version)

    expect(once).toBe(twice)
    expect(twice).toBe(thrice)
  })

  test("#given release #when marker extracted and stamped again #then no duplicate markers created", () => {
    const body = "## Fixed\n\n- Bug"
    const version = "5.0.0-beta.88"

    const stamped = stampBackfillMarker(body, version)
    const { version: extracted } = extractBackfillMarker(stamped)
    const restamped = stampBackfillMarker(stamped, version)

    expect(extracted).toBe(version)
    expect(stamped).toBe(restamped)
    const markerCount = (restamped.match(/<!-- omo-backfill-marker:/g) || []).length
    expect(markerCount).toBe(1)
  })
})
