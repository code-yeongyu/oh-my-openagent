import { describe, test, expect } from "bun:test"
import { normalizeGlobPattern } from "../../src/tools/glob/cli"

describe("normalizeGlobPattern", () => {
  describe("patterns with ** already present", () => {
    test("should return pattern unchanged when ** is present", () => {
      expect(normalizeGlobPattern("**/*.ts")).toBe("**/*.ts")
      expect(normalizeGlobPattern("src/**/*.md")).toBe("src/**/*.md")
    })
  })

  describe("path patterns without **", () => {
    test("should add **/ prefix and /** suffix for path patterns ending with *", () => {
      expect(normalizeGlobPattern(".cursor/specs/LIF-74*")).toBe("**/.cursor/specs/LIF-74*/**")
    })

    test("should add **/ prefix for path patterns without trailing *", () => {
      expect(normalizeGlobPattern("src/tools/")).toBe("**/src/tools/")
      expect(normalizeGlobPattern(".opencode/command/")).toBe("**/.opencode/command/")
    })
  })

  describe("path patterns ending with /*", () => {
    test("should add **/ prefix but NOT add /** suffix", () => {
      expect(normalizeGlobPattern("src/tools/*")).toBe("**/src/tools/*")
    })
  })

  describe("simple basename patterns", () => {
    test("should return simple basename patterns unchanged", () => {
      expect(normalizeGlobPattern("*.md")).toBe("*.md")
      expect(normalizeGlobPattern("*.ts")).toBe("*.ts")
      expect(normalizeGlobPattern("package.json")).toBe("package.json")
    })
  })

  describe("edge cases", () => {
    test("should return pattern unchanged if it already starts with **/", () => {
      expect(normalizeGlobPattern("**/")).toBe("**/")
    })

    test("should add **/ prefix for simple paths", () => {
      expect(normalizeGlobPattern("foo/bar.ts")).toBe("**/foo/bar.ts")
    })
  })
})
