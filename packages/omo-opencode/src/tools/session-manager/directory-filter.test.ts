import { describe, expect, test } from "bun:test"
import { normalizeSessionDirectory, sessionDirectoriesMatch } from "./directory-filter"

describe("directory-filter", () => {
  test("normalizeSessionDirectory strips trailing slash", () => {
    expect(normalizeSessionDirectory("/path/to/projectA/")).toBe("/path/to/projectA")
    expect(normalizeSessionDirectory("/path/to/projectA")).toBe("/path/to/projectA")
  })

  test("normalizeSessionDirectory keeps root sentinel", () => {
    expect(normalizeSessionDirectory("/")).toBe("/")
  })

  test("sessionDirectoriesMatch treats trailing slash as equal", () => {
    expect(sessionDirectoriesMatch("/path/to/projectA", "/path/to/projectA/")).toBe(true)
  })

  test("sessionDirectoriesMatch does not conflate distinct paths", () => {
    expect(sessionDirectoriesMatch("/path/to/projectA", "/path/to/projectAB")).toBe(false)
    expect(sessionDirectoriesMatch("/path/to/projectA", "/path/to/projectB")).toBe(false)
  })

  test("sessionDirectoriesMatch normalizes dot segments", () => {
    expect(sessionDirectoriesMatch("/path/to/./projectA", "/path/to/projectA")).toBe(true)
  })
})