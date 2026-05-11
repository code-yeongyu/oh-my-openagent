import { describe, test, expect } from "bun:test"
import { shouldRenameSession } from "./should-rename"

describe("shouldRenameSession", () => {
  test("never renames subagent sessions", () => {
    // given
    const input = { isSubagent: true, currentTitle: undefined }

    // when / then
    expect(shouldRenameSession(input)).toBe(false)
  })

  test("renames when title is missing", () => {
    expect(shouldRenameSession({ isSubagent: false, currentTitle: undefined })).toBe(true)
  })

  test("renames when title is empty or placeholder", () => {
    for (const title of ["", "  ", "New Session", "untitled", "Untitled session"]) {
      expect(shouldRenameSession({ isSubagent: false, currentTitle: title })).toBe(true)
    }
  })

  test("does not rename when title is already a friendly name", () => {
    for (const title of ["strawberry-carrot", "kiwi-zucchini", "mango-pea-2"]) {
      expect(shouldRenameSession({ isSubagent: false, currentTitle: title })).toBe(false)
    }
  })

  test("renames when title looks like a truncated prompt", () => {
    // given - short, contains whitespace, not a friendly name
    const input = { isSubagent: false, currentTitle: "fix the auth bug" }

    // when / then
    expect(shouldRenameSession(input)).toBe(true)
  })

  test("does not rename when user passed a single-word custom title", () => {
    // given - a custom title without whitespace is treated as user-set
    const input = { isSubagent: false, currentTitle: "MyProject" }

    // when / then
    expect(shouldRenameSession(input)).toBe(false)
  })

  test("does not rename when title is too long to be a truncated prompt", () => {
    // given
    const longTitle = "Refactor the authentication module to use the new TokenStore interface across all entry points and update tests"

    // when / then
    expect(shouldRenameSession({ isSubagent: false, currentTitle: longTitle })).toBe(false)
  })
})
