import { describe, expect, test } from "bun:test"
import { EXCLUDED_DIRS } from "./excluded-dirs"
import { EXCLUDED_DIRS as EXCLUDED_DIRS_FROM_BARREL } from "."

describe("EXCLUDED_DIRS", () => {
  test("contains the well-known junk directories we never want to recurse into", () => {
    // given
    const expected = [
      "node_modules",
      ".git",
      "dist",
      "build",
      ".next",
      ".sisyphus",
      ".omx",
      ".turbo",
      "coverage",
      "out",
      ".cache",
      ".vscode-test",
      "target",
      ".local-ignore",
    ]

    // when / then
    for (const name of expected) {
      expect(EXCLUDED_DIRS.has(name)).toBe(true)
    }
  })

  test("does not contain commonly-wanted project directories", () => {
    // given
    const shouldBeAllowed = ["src", "lib", "tests", "test", "docs", ".github", ".cursor", ".claude", ".opencode"]

    // when / then
    for (const name of shouldBeAllowed) {
      expect(EXCLUDED_DIRS.has(name)).toBe(false)
    }
  })

  test("is frozen so consumers cannot mutate shared state", () => {
    // given / when / then
    expect(Object.isFrozen(EXCLUDED_DIRS)).toBe(true)
  })

  test("is re-exported from the shared barrel", () => {
    // given / when / then
    expect(EXCLUDED_DIRS_FROM_BARREL).toBe(EXCLUDED_DIRS)
  })
})
