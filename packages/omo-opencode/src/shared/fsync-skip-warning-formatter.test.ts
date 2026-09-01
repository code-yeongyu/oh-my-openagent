import { describe, expect, it } from "bun:test"

import type { FsyncSkipEntry } from "./fsync-skip-tracker"
import { formatFsyncSkipWarning } from "./fsync-skip-warning-formatter"

function makeEntry(index: number, classification: FsyncSkipEntry["pathClassification"]): FsyncSkipEntry {
  return {
    filePath: `/path/${index}`,
    contextLabel: `atomicWrite:/path/${index}`,
    errorCode: "EPERM",
    message: "operation not permitted",
    pathClassification: classification,
    timestamp: 1000 + index,
  }
}

describe("formatFsyncSkipWarning", () => {
  it("returns empty string for zero entries", () => {
    expect(formatFsyncSkipWarning([])).toBe("")
  })

  it("includes iCloud environment, path, and code for one entry", () => {
    const warning = formatFsyncSkipWarning([makeEntry(1, "icloud")])
    expect(warning).toContain("iCloud Drive")
    expect(warning).toContain("/path/1")
    expect(warning).toContain("EPERM")
  })

  it("shows all five paths when exactly five entries exist", () => {
    const warning = formatFsyncSkipWarning([
      makeEntry(1, "icloud"),
      makeEntry(2, "icloud"),
      makeEntry(3, "icloud"),
      makeEntry(4, "icloud"),
      makeEntry(5, "icloud"),
    ])

    expect(warning).toContain("/path/1")
    expect(warning).toContain("/path/5")
    expect(warning).not.toContain("and 1 more")
  })

  it("shows five paths plus overflow summary when six entries exist", () => {
    const warning = formatFsyncSkipWarning([
      makeEntry(1, "icloud"),
      makeEntry(2, "icloud"),
      makeEntry(3, "icloud"),
      makeEntry(4, "icloud"),
      makeEntry(5, "icloud"),
      makeEntry(6, "icloud"),
    ])

    expect(warning).toContain("/path/5")
    expect(warning).not.toContain("/path/6")
    expect(warning).toContain("... and 1 more")
  })

  it("uses the most common classification when entries are mixed", () => {
    const warning = formatFsyncSkipWarning([
      makeEntry(1, "onedrive"),
      makeEntry(2, "onedrive"),
      makeEntry(3, "icloud"),
    ])

    expect(warning).toContain("Detected environment: OneDrive")
  })

  it("matches required section format", () => {
    const warning = formatFsyncSkipWarning([makeEntry(1, "unknown")])

    expect(warning).toContain("[fsync-skipped] 1 write(s) bypassed fsync")
    expect(warning).toContain("Affected paths:")
    expect(warning).toContain("What this means:")
    expect(warning).toContain("The write+rename succeeded")
    expect(warning).not.toContain("Detected environment:")
    expect(warning).toContain("filesystem does not support fsync")
  })
})
