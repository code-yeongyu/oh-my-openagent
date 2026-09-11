import { describe, expect, test } from "bun:test"
import { extractLegacyLedger, normalizeReleaseSections } from "./changelog-normalize"
import { extractReleaseNotes } from "./changelog-release-notes"

describe("normalizeReleaseSections", () => {
  test("#given a release body with its own H2 #when normalized #then the whole body survives extraction", () => {
    const before = [
      "# Changelog",
      "",
      "## [1.0.0] - 2026-01-01",
      "",
      "## Highlights",
      "",
      "- kept",
      "",
      "## [0.9.0] - 2025-12-01",
      "",
      "- older",
      "",
    ].join("\n")
    // before the repair the stray H2 ends the section immediately, so the body is lost entirely
    expect(() => extractReleaseNotes(before, "1.0.0")).toThrow(/empty/)
    const after = normalizeReleaseSections(before)
    const notes = extractReleaseNotes(after, "1.0.0")
    expect(notes).toContain("### Highlights")
    expect(notes).toContain("- kept")
    expect(extractReleaseNotes(after, "0.9.0")).toBe("- older")
  })

  test("#given nested headings #when normalized #then relative depth is preserved", () => {
    const before = "# C\n\n## [1.0.0] - 2026-01-01\n\n## A\n\n### B\n\n#### C\n"
    const after = normalizeReleaseSections(before)
    expect(after).toContain("### A")
    expect(after).toContain("#### B")
    expect(after).toContain("##### C")
  })

  test("#given a heading inside a code fence #when normalized #then it is left alone", () => {
    const before = ["# C", "", "## [1.0.0] - 2026-01-01", "", "```md", "## not a heading", "```", ""].join("\n")
    expect(normalizeReleaseSections(before)).toContain("## not a heading")
  })

  test("#given no release sections #when normalized #then the document is unchanged", () => {
    const doc = "# Changelog\n\n## [Unreleased]\n\n- pending\n"
    expect(normalizeReleaseSections(doc)).toBe(doc)
  })
})

describe("extractLegacyLedger", () => {
  test("#given accumulated Unreleased content #when extracted #then it moves to a labelled ledger and Unreleased empties", () => {
    const before = "# C\n\n## [Unreleased]\n\n- old accumulated\n\n## [1.0.0] - 2026-01-01\n\n- released\n"
    const after = extractLegacyLedger(before)
    expect(after).toContain("## Development ledger (pre-backfill, unversioned)")
    expect(after).toContain("- old accumulated")
    // Unreleased is now empty, so a release must fail closed until real notes are written
    expect(() => extractReleaseNotes(after, "1.0.0")).not.toThrow()
    const unreleasedBody = after.slice(after.indexOf("## [Unreleased]") + "## [Unreleased]".length)
    expect(unreleasedBody.slice(0, unreleasedBody.search(/^## /m)).trim()).toBe("")
  })

  test("#given an already empty Unreleased #when extracted #then nothing changes", () => {
    const doc = "# C\n\n## [Unreleased]\n\n## [1.0.0] - 2026-01-01\n\n- x\n"
    expect(extractLegacyLedger(doc)).toBe(doc)
  })
})
