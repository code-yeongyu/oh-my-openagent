import { describe, test, expect, beforeEach, afterEach } from "bun:test"
import {
  parseVersion,
  compareVersions,
  isVersionGte,
  isVersionLt,
  getOpenCodeVersion,
  isOpenCodeVersionAtLeast,
  resetVersionCache,
  setVersionCache,
  MINIMUM_OPENCODE_VERSION,
} from "./opencode-version"

describe("opencode-version", () => {
  describe("parseVersion", () => {
    test("parses simple version", () => {
      // #given a simple version string
      const version = "1.2.3"

      // #when parsed
      const result = parseVersion(version)

      // #then returns array of numbers
      expect(result).toEqual([1, 2, 3])
    })

    test("handles v prefix", () => {
      // #given version with v prefix
      const version = "v1.2.3"

      // #when parsed
      const result = parseVersion(version)

      // #then strips prefix and parses correctly
      expect(result).toEqual([1, 2, 3])
    })

    test("handles prerelease suffix", () => {
      // #given version with prerelease
      const version = "1.2.3-beta.1"

      // #when parsed
      const result = parseVersion(version)

      // #then ignores prerelease part
      expect(result).toEqual([1, 2, 3])
    })

    test("handles two-part version", () => {
      // #given two-part version
      const version = "1.2"

      // #when parsed
      const result = parseVersion(version)

      // #then returns two numbers
      expect(result).toEqual([1, 2])
    })
  })

  describe("compareVersions", () => {
    test("returns 0 for equal versions", () => {
      // #given two equal versions
      // #when compared
      const result = compareVersions("1.1.1", "1.1.1")

      // #then returns 0
      expect(result).toBe(0)
    })

    test("returns 1 when a > b", () => {
      // #given a is greater than b
      // #when compared
      const result = compareVersions("1.2.0", "1.1.0")

      // #then returns 1
      expect(result).toBe(1)
    })

    test("returns -1 when a < b", () => {
      // #given a is less than b
      // #when compared
      const result = compareVersions("1.0.9", "1.1.0")

      // #then returns -1
      expect(result).toBe(-1)
    })

    test("handles different length versions", () => {
      // #given versions with different lengths
      // #when compared
      expect(compareVersions("1.1", "1.1.0")).toBe(0)
      expect(compareVersions("1.1.1", "1.1")).toBe(1)
      expect(compareVersions("1.1", "1.1.1")).toBe(-1)
    })

    test("handles major version differences", () => {
      // #given major version difference
      // #when compared
      expect(compareVersions("2.0.0", "1.9.9")).toBe(1)
      expect(compareVersions("1.9.9", "2.0.0")).toBe(-1)
    })
  })

  describe("isVersionGte", () => {
    test("returns true when a >= b", () => {
      expect(isVersionGte("1.1.1", "1.1.1")).toBe(true)
      expect(isVersionGte("1.1.2", "1.1.1")).toBe(true)
      expect(isVersionGte("1.2.0", "1.1.1")).toBe(true)
      expect(isVersionGte("2.0.0", "1.1.1")).toBe(true)
    })

    test("returns false when a < b", () => {
      expect(isVersionGte("1.1.0", "1.1.1")).toBe(false)
      expect(isVersionGte("1.0.9", "1.1.1")).toBe(false)
      expect(isVersionGte("0.9.9", "1.1.1")).toBe(false)
    })
  })

  describe("isVersionLt", () => {
    test("returns true when a < b", () => {
      expect(isVersionLt("1.1.0", "1.1.1")).toBe(true)
      expect(isVersionLt("1.0.150", "1.1.1")).toBe(true)
    })

    test("returns false when a >= b", () => {
      expect(isVersionLt("1.1.1", "1.1.1")).toBe(false)
      expect(isVersionLt("1.1.2", "1.1.1")).toBe(false)
    })
  })

  describe("getOpenCodeVersion", () => {
    beforeEach(() => {
      resetVersionCache()
    })

    afterEach(() => {
      resetVersionCache()
    })

    test("returns cached version on subsequent calls", () => {
      // #given version is set in cache
      setVersionCache("1.2.3")

      // #when getting version
      const result = getOpenCodeVersion()

      // #then returns cached value
      expect(result).toBe("1.2.3")
    })

    test("returns null when cache is set to null", () => {
      // #given cache is explicitly set to null
      setVersionCache(null)

      // #when getting version (cache is already set)
      const result = getOpenCodeVersion()

      // #then returns null without executing command
      expect(result).toBe(null)
    })
  })

  describe("isOpenCodeVersionAtLeast", () => {
    beforeEach(() => {
      resetVersionCache()
    })

    afterEach(() => {
      resetVersionCache()
    })

    test("returns true for exact version", () => {
      // #given version is 1.1.1
      setVersionCache("1.1.1")

      // #when checking against 1.1.1
      const result = isOpenCodeVersionAtLeast("1.1.1")

      // #then returns true
      expect(result).toBe(true)
    })

    test("returns true for versions above target", () => {
      // #given version is above target
      setVersionCache("1.2.0")

      // #when checking against 1.1.1
      const result = isOpenCodeVersionAtLeast("1.1.1")

      // #then returns true
      expect(result).toBe(true)
    })

    test("returns false for versions below target", () => {
      // #given version is below target
      setVersionCache("1.1.0")

      // #when checking against 1.1.1
      const result = isOpenCodeVersionAtLeast("1.1.1")

      // #then returns false
      expect(result).toBe(false)
    })

    test("returns true when version cannot be detected", () => {
      // #given version is null (undetectable)
      setVersionCache(null)

      // #when checking
      const result = isOpenCodeVersionAtLeast("1.1.1")

      // #then returns true (assume newer version)
      expect(result).toBe(true)
    })
  })

  describe("MINIMUM_OPENCODE_VERSION", () => {
    test("is set to 1.1.1", () => {
      expect(MINIMUM_OPENCODE_VERSION).toBe("1.1.1")
    })
  })
})
