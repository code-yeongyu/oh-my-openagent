import { describe, expect, test, beforeEach } from "bun:test"

import {
  globalProviderBlacklist,
  isProviderBlacklisted,
  blacklistProvider,
  getBlacklistedProviders,
  RETRYABLE_ERROR_PATTERNS,
} from "./constants"

describe("runtime-fallback constants", () => {
  beforeEach(() => {
    globalProviderBlacklist.clear()
  })

  describe("globalProviderBlacklist", () => {
    test("blacklistProvider adds provider to blacklist", () => {
      //#given
      const provider = "anthropic"

      //#when
      blacklistProvider(provider)

      //#then
      expect(globalProviderBlacklist.has(provider)).toBe(true)
      expect(globalProviderBlacklist.get(provider)).toBeGreaterThan(0)
    })

    test("isProviderBlacklisted returns true for blacklisted provider", () => {
      //#given
      blacklistProvider("anthropic")

      //#when
      const result = isProviderBlacklisted("anthropic", 3600)

      //#then
      expect(result).toBe(true)
    })

    test("isProviderBlacklisted returns false for non-blacklisted provider", () => {
      //#given - no providers blacklisted

      //#when
      const result = isProviderBlacklisted("openai", 3600)

      //#then
      expect(result).toBe(false)
    })

    test("isProviderBlacklisted returns false after cooldown expires", () => {
      //#given
      const oldTimestamp = Date.now() - 3700 * 1000 // 1 hour + 100 seconds ago
      globalProviderBlacklist.set("anthropic", oldTimestamp)

      //#when
      const result = isProviderBlacklisted("anthropic", 3600)

      //#then
      expect(result).toBe(false)
      expect(globalProviderBlacklist.has("anthropic")).toBe(false) // Should be cleaned up
    })

    test("getBlacklistedProviders returns all blacklisted providers within cooldown", () => {
      //#given
      blacklistProvider("anthropic")
      blacklistProvider("openai")
      const oldTimestamp = Date.now() - 3700 * 1000
      globalProviderBlacklist.set("google", oldTimestamp) // Expired

      //#when
      const result = getBlacklistedProviders(3600)

      //#then
      expect(result).toContain("anthropic")
      expect(result).toContain("openai")
      expect(result).not.toContain("google")
    })

    test("getBlacklistedProviders cleans up expired entries", () => {
      //#given
      const oldTimestamp = Date.now() - 3700 * 1000
      globalProviderBlacklist.set("expired", oldTimestamp)

      //#when
      getBlacklistedProviders(3600)

      //#then
      expect(globalProviderBlacklist.has("expired")).toBe(false)
    })
  })

  describe("RETRYABLE_ERROR_PATTERNS", () => {
    test("matches rate limit errors", () => {
      const pattern = RETRYABLE_ERROR_PATTERNS.find((p) => p.source.includes("rate"))
      expect(pattern?.test("Rate limit exceeded")).toBe(true)
      expect(pattern?.test("rate_limit error")).toBe(true)
    })

    test("matches limit exhausted errors", () => {
      const pattern = RETRYABLE_ERROR_PATTERNS.find((p) => p.source.includes("limit") && p.source.includes("exhausted"))
      expect(pattern?.test("Weekly/Monthly Limit Exhausted")).toBe(true)
      expect(pattern?.test("Limit exhausted")).toBe(true)
    })

    test("matches weekly/monthly limit errors", () => {
      const pattern = RETRYABLE_ERROR_PATTERNS.find((p) => p.source.includes("weekly"))
      expect(pattern?.test("Weekly/Monthly Limit Exhausted")).toBe(true)
    })

    test("matches 'your limit will reset' errors", () => {
      const pattern = RETRYABLE_ERROR_PATTERNS.find((p) => p.source.includes("your") && p.source.includes("reset"))
      expect(pattern?.test("Your limit will reset at 2026-03-14 09:17:47")).toBe(true)
    })

    test("matches HTTP status codes", () => {
      const pattern429 = RETRYABLE_ERROR_PATTERNS.find((p) => p.source.includes("429"))
      expect(pattern429?.test("Error 429")).toBe(true)
      expect(pattern429?.test("status 429")).toBe(true)
    })
  })
})
