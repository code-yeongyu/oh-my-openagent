import { describe, it, expect } from "bun:test"
import {
  RegexMatcher,
  GlobMatcher,
  createRegexMatcher,
  createGlobMatcher,
  createMatcher,
  matchesAny,
  matchesAll,
} from "./index"

describe("RegexMatcher", () => {
  describe("basic matching", () => {
    it("#then should match .ts files with regex pattern", () => {
      //#given
      const matcher = new RegexMatcher("\\.ts$")

      //#when
      const result = matcher.matches("file.ts")

      //#then
      expect(result).toBe(true)
    })

    it("#then should not match .js files with .ts pattern", () => {
      //#given
      const matcher = new RegexMatcher("\\.ts$")

      //#when
      const result = matcher.matches("file.js")

      //#then
      expect(result).toBe(false)
    })

    it("#then should support case-insensitive matching", () => {
      //#given
      const matcher = new RegexMatcher("readme", { caseInsensitive: true })

      //#when
      const resultUpper = matcher.matches("README.md")
      const resultLower = matcher.matches("readme.md")

      //#then
      expect(resultUpper).toBe(true)
      expect(resultLower).toBe(true)
    })

    it("#then should handle invalid regex gracefully", () => {
      //#given
      const matcher = new RegexMatcher("[invalid(regex")

      //#when
      const result = matcher.matches("anything")

      //#then
      expect(result).toBe(false)
      expect(matcher.isValid()).toBe(false)
    })

    it("#then should report valid regex as valid", () => {
      //#given
      const matcher = new RegexMatcher("^valid$")

      //#then
      expect(matcher.isValid()).toBe(true)
    })
  })

  describe("createRegexMatcher", () => {
    it("#then should create a working matcher", () => {
      //#given
      const matcher = createRegexMatcher("test")

      //#when
      const result = matcher.matches("testing")

      //#then
      expect(result).toBe(true)
    })
  })
})

describe("GlobMatcher", () => {
  describe("basic glob patterns", () => {
    it("#then should match with single wildcard", () => {
      //#given
      const matcher = new GlobMatcher("*.ts")

      //#when
      const resultTs = matcher.matches("file.ts")
      const resultJs = matcher.matches("file.js")

      //#then
      expect(resultTs).toBe(true)
      expect(resultJs).toBe(false)
    })

    it("#then should match with double wildcard for deep paths", () => {
      //#given
      const matcher = new GlobMatcher("src/**/*.ts")

      //#when
      const resultDeep = matcher.matches("src/hooks/index.ts")
      const resultShallow = matcher.matches("src/index.ts")
      const resultOutside = matcher.matches("lib/index.ts")

      //#then
      expect(resultDeep).toBe(true)
      expect(resultShallow).toBe(true)
      expect(resultOutside).toBe(false)
    })

    it("#then should match with question mark for single character", () => {
      //#given
      const matcher = new GlobMatcher("file?.ts")

      //#when
      const result1 = matcher.matches("file1.ts")
      const result2 = matcher.matches("file12.ts")

      //#then
      expect(result1).toBe(true)
      expect(result2).toBe(false)
    })

    it("#then should handle empty pattern as match all", () => {
      //#given
      const matcher = new GlobMatcher("")

      //#when
      const result = matcher.matches("anything.ts")

      //#then
      expect(result).toBe(true)
    })

    it("#then should normalize backslashes to forward slashes", () => {
      //#given
      const matcher = new GlobMatcher("src/**/*.ts")

      //#when
      const result = matcher.matches("src\\hooks\\index.ts")

      //#then
      expect(result).toBe(true)
    })
  })

  describe("createGlobMatcher", () => {
    it("#then should create a working matcher", () => {
      //#given
      const matcher = createGlobMatcher("**/*.md")

      //#when
      const result = matcher.matches("docs/readme.md")

      //#then
      expect(result).toBe(true)
    })
  })
})

describe("createMatcher", () => {
  it("#then should auto-detect glob pattern", () => {
    //#given
    const matcher = createMatcher("src/**/*.ts")

    //#then
    expect(matcher.type).toBe("glob")
    expect(matcher.matches("src/hooks/index.ts")).toBe(true)
  })

  it("#then should auto-detect regex pattern", () => {
    //#given
    const matcher = createMatcher("^\\.ts$")

    //#then
    expect(matcher.type).toBe("regex")
  })

  it("#then should force regex type when specified", () => {
    //#given
    const matcher = createMatcher("*.ts", "regex")

    //#then
    expect(matcher.type).toBe("regex")
  })

  it("#then should force glob type when specified", () => {
    //#given
    const matcher = createMatcher("test", "glob")

    //#then
    expect(matcher.type).toBe("glob")
  })
})

describe("matchesAny", () => {
  it("#then should return true if any matcher matches", () => {
    //#given
    const matchers = [
      createGlobMatcher("*.ts"),
      createGlobMatcher("*.js"),
    ]

    //#when
    const result = matchesAny("file.ts", matchers)

    //#then
    expect(result).toBe(true)
  })

  it("#then should return false if no matcher matches", () => {
    //#given
    const matchers = [
      createGlobMatcher("*.ts"),
      createGlobMatcher("*.js"),
    ]

    //#when
    const result = matchesAny("file.md", matchers)

    //#then
    expect(result).toBe(false)
  })
})

describe("matchesAll", () => {
  it("#then should return true if all matchers match", () => {
    //#given
    const matchers = [
      createGlobMatcher("src/*"),
      createRegexMatcher("\\.ts$"),
    ]

    //#when
    const result = matchesAll("src/file.ts", matchers)

    //#then
    expect(result).toBe(true)
  })

  it("#then should return false if any matcher fails", () => {
    //#given
    const matchers = [
      createGlobMatcher("src/*"),
      createRegexMatcher("\\.ts$"),
    ]

    //#when
    const result = matchesAll("src/file.js", matchers)

    //#then
    expect(result).toBe(false)
  })
})
