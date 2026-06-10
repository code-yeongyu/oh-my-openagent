/// <reference types="bun-types" />

import { describe, expect, it } from "bun:test"
import { extractSemverFromOutput } from "../../../shared/extract-semver"

describe("extractSemverFromOutput", () => {
  describe("#given clean version output #when extractSemverFromOutput #then returns the semver token", () => {
    it("plain semver", () => {
      expect(extractSemverFromOutput("1.14.33")).toBe("1.14.33")
    })

    it("v-prefixed semver strips the prefix", () => {
      expect(extractSemverFromOutput("v1.14.33")).toBe("1.14.33")
    })

    it("trailing whitespace and newlines are tolerated", () => {
      expect(extractSemverFromOutput("  1.14.33\n")).toBe("1.14.33")
    })

    it("pre-release suffix is preserved", () => {
      expect(extractSemverFromOutput("1.0.0-beta.1")).toBe("1.0.0-beta.1")
    })

    it("build metadata is preserved", () => {
      expect(extractSemverFromOutput("1.0.0+build.42")).toBe("1.0.0+build.42")
    })
  })

  describe("#given Electron log-polluted stdout #when extractSemverFromOutput #then ignores the timestamp and finds the version", () => {
    it("regression for #3765: Electron desktop dumps log lines into stdout", () => {
      const polluted = "00:24:25.202 > app starting { version: '1.14.33', packaged: true }"
      expect(extractSemverFromOutput(polluted)).toBe("1.14.33")
    })

    it("multi-line stdout with log prefix and trailing version", () => {
      const polluted = "12:00:00.001 [info] starting opencode\n1.14.33\n"
      expect(extractSemverFromOutput(polluted)).toBe("1.14.33")
    })

    it("timestamp-only stdout returns null", () => {
      expect(extractSemverFromOutput("00:24:25.202 some log line")).toBe(null)
    })
  })

  describe("#given empty or invalid output #when extractSemverFromOutput #then returns null", () => {
    it("empty string", () => {
      expect(extractSemverFromOutput("")).toBe(null)
    })

    it("only whitespace", () => {
      expect(extractSemverFromOutput("   \n  ")).toBe(null)
    })

    it("text without any semver-shaped token", () => {
      expect(extractSemverFromOutput("hello world")).toBe(null)
    })

    it("incomplete semver (only major.minor) is rejected", () => {
      expect(extractSemverFromOutput("1.14")).toBe(null)
    })
  })
})
