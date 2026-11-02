import { describe, expect, test } from "bun:test"

import { sameVersion } from "../bin/lib/same-version.js"

describe("sameVersion", () => {
  test.each([
    ["2026.11.02-1", "2026.11.2-1", true],
    ["2026.11.2-1", "2026.11.02-1", true],
    ["2026.08.09", "2026.8.9", true],
    ["2026.11.2-1", "2026.11.2-1", true],
    ["v2026.11.2-1", "2026.11.2-1", true],
    ["2026.11.2-1+build.7", "2026.11.2-1", true],
    ["2026.11.2-1", "2026.11.2-2", false],
    ["2026.11.2-1", "2026.11.20-1", false],
    ["2026.11.2-1", "2026.1.12-1", false],
    ["2026.11.2-1", "2026.11.2", false],
    ["2026.11.2-beta.01", "2026.11.2-beta.1", true],
    ["2026.11.2-beta.1", "2026.11.2-rc.1", false],
  ])("#given %s and %s #then same release is %p", (left, right, expected) => {
    expect(sameVersion(left, right)).toBe(expected)
  })

  test("#given a missing version #then it is never the pinned release", () => {
    expect(sameVersion(undefined, "2026.11.2-1")).toBe(false)
    expect(sameVersion("2026.11.2-1", null)).toBe(false)
  })
})
