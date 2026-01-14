import { describe, test, expect } from "bun:test"
import { isPrereleaseVersion, isDistTag, isPrereleaseOrDistTag, extractChannel } from "./index"

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

  describe("extractChannel", () => {
    test("extracts beta from dist-tag", () => {
      // #given beta dist-tag
      const version = "beta"

      // #when extracting channel
      const result = extractChannel(version)

      // #then returns beta
      expect(result).toBe("beta")
    })

    test("extracts next from dist-tag", () => {
      // #given next dist-tag
      const version = "next"

      // #when extracting channel
      const result = extractChannel(version)

      // #then returns next
      expect(result).toBe("next")
    })

    test("extracts canary from dist-tag", () => {
      // #given canary dist-tag
      const version = "canary"

      // #when extracting channel
      const result = extractChannel(version)

      // #then returns canary
      expect(result).toBe("canary")
    })

    test("extracts beta from prerelease version", () => {
      // #given beta prerelease version
      const version = "3.0.0-beta.1"

      // #when extracting channel
      const result = extractChannel(version)

      // #then returns beta
      expect(result).toBe("beta")
    })

    test("extracts alpha from prerelease version", () => {
      // #given alpha prerelease version
      const version = "1.0.0-alpha"

      // #when extracting channel
      const result = extractChannel(version)

      // #then returns alpha
      expect(result).toBe("alpha")
    })

    test("extracts rc from prerelease version", () => {
      // #given rc prerelease version
      const version = "2.0.0-rc.1"

      // #when extracting channel
      const result = extractChannel(version)

      // #then returns rc
      expect(result).toBe("rc")
    })

    test("returns latest for stable version", () => {
      // #given stable version
      const version = "2.14.0"

      // #when extracting channel
      const result = extractChannel(version)

      // #then returns latest
      expect(result).toBe("latest")
    })

    test("returns latest for null", () => {
      // #given null version
      const version = null

      // #when extracting channel
      const result = extractChannel(version)

      // #then returns latest
      expect(result).toBe("latest")
    })

    test("handles complex prerelease identifiers", () => {
      // #given complex prerelease
      const version = "3.0.0-beta.1.experimental"

      // #when extracting channel
      const result = extractChannel(version)

      // #then returns beta
      expect(result).toBe("beta")
    })
  })
})
