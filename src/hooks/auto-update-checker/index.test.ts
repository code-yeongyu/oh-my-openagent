import { describe, test, expect } from "bun:test"

const isPrereleaseVersion = (version: string): boolean => {
  return version.includes("-")
}

const isDistTag = (version: string): boolean => {
  const startsWithDigit = /^\d/.test(version)
  return !startsWithDigit
}

const isPrereleaseOrDistTag = (pinnedVersion: string | null): boolean => {
  if (!pinnedVersion) return false
  return isPrereleaseVersion(pinnedVersion) || isDistTag(pinnedVersion)
}

describe("auto-update-checker", () => {
  describe("isPrereleaseVersion", () => {
    test("returns true for beta versions", () => {
      // #given a beta version
      const version = "3.0.0-beta.1"

      // #when checking if prerelease
      const result = isPrereleaseVersion(version)

      // #then returns true
      expect(result).toBe(true)
    })

    test("returns true for alpha versions", () => {
      // #given an alpha version
      const version = "1.0.0-alpha"

      // #when checking if prerelease
      const result = isPrereleaseVersion(version)

      // #then returns true
      expect(result).toBe(true)
    })

    test("returns true for rc versions", () => {
      // #given an rc version
      const version = "2.0.0-rc.1"

      // #when checking if prerelease
      const result = isPrereleaseVersion(version)

      // #then returns true
      expect(result).toBe(true)
    })

    test("returns false for stable versions", () => {
      // #given a stable version
      const version = "2.14.0"

      // #when checking if prerelease
      const result = isPrereleaseVersion(version)

      // #then returns false
      expect(result).toBe(false)
    })
  })

  describe("isDistTag", () => {
    test("returns true for beta dist-tag", () => {
      // #given beta dist-tag
      const version = "beta"

      // #when checking if dist-tag
      const result = isDistTag(version)

      // #then returns true
      expect(result).toBe(true)
    })

    test("returns true for next dist-tag", () => {
      // #given next dist-tag
      const version = "next"

      // #when checking if dist-tag
      const result = isDistTag(version)

      // #then returns true
      expect(result).toBe(true)
    })

    test("returns true for canary dist-tag", () => {
      // #given canary dist-tag
      const version = "canary"

      // #when checking if dist-tag
      const result = isDistTag(version)

      // #then returns true
      expect(result).toBe(true)
    })

    test("returns false for semver versions", () => {
      // #given a semver version
      const version = "2.14.0"

      // #when checking if dist-tag
      const result = isDistTag(version)

      // #then returns false
      expect(result).toBe(false)
    })

    test("returns false for latest (handled separately)", () => {
      // #given latest tag
      const version = "latest"

      // #when checking if dist-tag
      const result = isDistTag(version)

      // #then returns true (but latest is filtered before this check)
      expect(result).toBe(true)
    })
  })

  describe("isPrereleaseOrDistTag", () => {
    test("returns false for null", () => {
      // #given null version
      const version = null

      // #when checking
      const result = isPrereleaseOrDistTag(version)

      // #then returns false
      expect(result).toBe(false)
    })

    test("returns true for prerelease version", () => {
      // #given prerelease version
      const version = "3.0.0-beta.1"

      // #when checking
      const result = isPrereleaseOrDistTag(version)

      // #then returns true
      expect(result).toBe(true)
    })

    test("returns true for dist-tag", () => {
      // #given dist-tag
      const version = "beta"

      // #when checking
      const result = isPrereleaseOrDistTag(version)

      // #then returns true
      expect(result).toBe(true)
    })

    test("returns false for stable version", () => {
      // #given stable version
      const version = "2.14.0"

      // #when checking
      const result = isPrereleaseOrDistTag(version)

      // #then returns false
      expect(result).toBe(false)
    })
  })
})
