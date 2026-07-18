import { describe, expect, it } from "bun:test"
import { extractSemverFromOutput } from "./extract-semver"

describe("extractSemverFromOutput", () => {
  describe("#given blank or non-version output #when extracting semver #then it returns null", () => {
    it("returns null for blank output", () => {
      expect(extractSemverFromOutput("")).toBe(null)
      expect(extractSemverFromOutput(" \n\t ")).toBe(null)
    })

    it("returns null when output has no version", () => {
      expect(extractSemverFromOutput("opencode command completed without version text")).toBe(null)
    })
  })

  describe("#given semver output #when extracting semver #then it returns the version token", () => {
    it("accepts an optional leading v", () => {
      expect(extractSemverFromOutput("v1.2.3")).toBe("1.2.3")
      expect(extractSemverFromOutput("1.2.3")).toBe("1.2.3")
    })

    it("supports prerelease and build metadata", () => {
      expect(extractSemverFromOutput("release 1.2.3-beta.4+build.20260627")).toBe(
        "1.2.3-beta.4+build.20260627",
      )
    })
  })

  describe("#given noisy command output #when extracting semver #then it finds the real version", () => {
    it("ignores timestamp-like millisecond fragments and extracts a later semver", () => {
      const output = "00:24:25.202 [info] booting\nopencode v1.14.33"

      expect(extractSemverFromOutput(output)).toBe("1.14.33")
    })

    it("trims multiline noisy command output", () => {
      const output = "\nwarning: stale cache ignored\n  detected version 2.0.1\n"

      expect(extractSemverFromOutput(output)).toBe("2.0.1")
    })
  })
})
