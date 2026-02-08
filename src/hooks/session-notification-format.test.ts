import { describe, expect, test } from "bun:test"

import { extractProjectName, resolveMessageFormat } from "./session-notification-format"

describe("session-notification-format", () => {
  describe("resolveMessageFormat", () => {
    test("should replace {project} variable", () => {
      // given - a format string with {project} placeholder
      const format = "{project} — Agent is ready"
      const vars = { project: "my-app", cwd: "/home/user/my-app" }

      // when - resolving the format
      const result = resolveMessageFormat(format, vars)

      // then - {project} should be replaced with the project value
      expect(result).toBe("my-app — Agent is ready")
    })

    test("should replace {cwd} variable", () => {
      // given - a format string with {cwd} placeholder
      const format = "{cwd} is idle"
      const vars = { project: "app", cwd: "/full/path/app" }

      // when - resolving the format
      const result = resolveMessageFormat(format, vars)

      // then - {cwd} should be replaced with the cwd value
      expect(result).toBe("/full/path/app is idle")
    })

    test("should replace both {project} and {cwd} variables", () => {
      // given - a format string with both placeholders
      const format = "Both {project} and {cwd}"
      const vars = { project: "p", cwd: "/c" }

      // when - resolving the format
      const result = resolveMessageFormat(format, vars)

      // then - both variables should be replaced
      expect(result).toBe("Both p and /c")
    })

    test("should leave strings without variables unchanged", () => {
      // given - a format string with no placeholders
      const format = "No variables here"
      const vars = { project: "p", cwd: "/c" }

      // when - resolving the format
      const result = resolveMessageFormat(format, vars)

      // then - the string should remain unchanged
      expect(result).toBe("No variables here")
    })

    test("should leave unrecognized variables as-is", () => {
      // given - a format string with an unrecognized variable
      const format = "{unknown} stays"
      const vars = { project: "p", cwd: "/c" }

      // when - resolving the format
      const result = resolveMessageFormat(format, vars)

      // then - unrecognized variables should pass through unchanged
      expect(result).toBe("{unknown} stays")
    })

    test("should handle empty format string", () => {
      // given - an empty format string
      const format = ""
      const vars = { project: "p", cwd: "/c" }

      // when - resolving the format
      const result = resolveMessageFormat(format, vars)

      // then - should return empty string
      expect(result).toBe("")
    })
  })

  describe("extractProjectName", () => {
    test("should extract project name from directory path", () => {
      // given - a directory path
      const directory = "/home/user/my-project"

      // when - extracting the project name
      const result = extractProjectName(directory)

      // then - should return the last path component
      expect(result).toBe("my-project")
    })

    test("should return empty string for root path", () => {
      // given - the root path
      const directory = "/"

      // when - extracting the project name
      const result = extractProjectName(directory)

      // then - should return empty string
      expect(result).toBe("")
    })

    test("should return empty string for empty input", () => {
      // given - an empty string
      const directory = ""

      // when - extracting the project name
      const result = extractProjectName(directory)

      // then - should return empty string
      expect(result).toBe("")
    })

    test("should handle trailing slash in path", () => {
      // given - a directory path with trailing slash
      const directory = "/home/user/project/"

      // when - extracting the project name
      const result = extractProjectName(directory)

      // then - should return the project name without the slash
      expect(result).toBe("project")
    })
  })
})
