import { describe, it, expect } from "bun:test"
import {
  ANTIGRAVITY_TOKEN_REFRESH_BUFFER_MS,
  ANTIGRAVITY_ENDPOINT_FALLBACKS,
  ANTIGRAVITY_CALLBACK_PORT,
} from "./constants"

describe("Antigravity Constants", () => {
  describe("ANTIGRAVITY_TOKEN_REFRESH_BUFFER_MS", () => {
    it("should be 50 minutes (3,000,000ms) to match CLIProxyAPI", () => {
      // #given
      const FIFTY_MINUTES_MS = 50 * 60 * 1000 // 3,000,000

      // #when
      const actual = ANTIGRAVITY_TOKEN_REFRESH_BUFFER_MS

      // #then
      expect(actual).toBe(FIFTY_MINUTES_MS)
    })
  })

  describe("ANTIGRAVITY_ENDPOINT_FALLBACKS", () => {
    it("should have exactly 2 endpoints (daily → prod)", () => {
      // #given
      const expectedCount = 2

      // #when
      const actual = ANTIGRAVITY_ENDPOINT_FALLBACKS

      // #then
      expect(actual).toHaveLength(expectedCount)
    })

    it("should have daily endpoint first", () => {
      // #then
      expect(ANTIGRAVITY_ENDPOINT_FALLBACKS[0]).toBe(
        "https://daily-cloudcode-pa.sandbox.googleapis.com"
      )
    })

    it("should have prod endpoint second", () => {
      // #then
      expect(ANTIGRAVITY_ENDPOINT_FALLBACKS[1]).toBe(
        "https://cloudcode-pa.googleapis.com"
      )
    })

    it("should NOT include autopush endpoint", () => {
      // #then
      const endpointsJoined = ANTIGRAVITY_ENDPOINT_FALLBACKS.join(",")
      const hasAutopush = endpointsJoined.includes("autopush-cloudcode-pa")
      expect(hasAutopush).toBe(false)
    })
  })

  describe("ANTIGRAVITY_CALLBACK_PORT", () => {
    it("should be 51121 to match CLIProxyAPI", () => {
      // #then
      expect(ANTIGRAVITY_CALLBACK_PORT).toBe(51121)
    })
  })
})
