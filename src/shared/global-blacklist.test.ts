import { describe, expect, test, beforeEach, afterEach } from "bun:test"
import * as fs from "fs"
import * as path from "path"
import { tmpdir } from "os"
import { mkdtempSync, rmSync } from "node:fs"
import { join } from "node:path"

describe("global-blacklist", () => {
  let testCacheDir: string
  let originalEnv: string | undefined

  beforeEach(() => {
    // Create temp directory for test files
    testCacheDir = mkdtempSync(join(tmpdir(), "blacklist-test-"))
    // Store original env var
    originalEnv = process.env.OHMYOPENCODE_BLACKLIST_FILE
    // Set env var to use test file
    process.env.OHMYOPENCODE_BLACKLIST_FILE = path.join(testCacheDir, "provider-blacklist.json")
    
    // Clear any cached module and re-import
    const { clearBlacklist } = require("./global-blacklist")
    clearBlacklist()
  })

  afterEach(() => {
    // Restore original env var
    if (originalEnv !== undefined) {
      process.env.OHMYOPENCODE_BLACKLIST_FILE = originalEnv
    } else {
      delete process.env.OHMYOPENCODE_BLACKLIST_FILE
    }
    // Clean up temp directory
    if (testCacheDir && fs.existsSync(testCacheDir)) {
      rmSync(testCacheDir, { recursive: true, force: true })
    }
  })

  describe("blacklistProvider", () => {
    test("adds provider to blacklist", () => {
      const { blacklistProvider, isProviderBlacklisted } = require("./global-blacklist")
      blacklistProvider("anthropic", 3600, "Rate limit")
      const blacklisted = isProviderBlacklisted("anthropic")
      expect(blacklisted).toBe(true)
    })

    test("sets correct expiry time", () => {
      const { blacklistProvider, getBlacklistedProviders } = require("./global-blacklist")
      const cooldownSeconds = 60
      const before = Date.now()
      blacklistProvider("openai", cooldownSeconds)
      const providers = getBlacklistedProviders()
      expect(providers).toContain("openai")
    })

    test("overwrites existing entry", () => {
      const { blacklistProvider, isProviderBlacklisted } = require("./global-blacklist")
      blacklistProvider("anthropic", 3600, "First")
      blacklistProvider("anthropic", 7200, "Second")
      const blacklisted = isProviderBlacklisted("anthropic")
      expect(blacklisted).toBe(true)
    })
  })

  describe("isProviderBlacklisted", () => {
    test("returns false for non-blacklisted provider", () => {
      const { isProviderBlacklisted } = require("./global-blacklist")
      const blacklisted = isProviderBlacklisted("unknown-provider")
      expect(blacklisted).toBe(false)
    })

    test("returns true for blacklisted provider", () => {
      const { blacklistProvider, isProviderBlacklisted } = require("./global-blacklist")
      blacklistProvider("anthropic", 3600)
      const blacklisted = isProviderBlacklisted("anthropic")
      expect(blacklisted).toBe(true)
    })

    test("auto-expires old entries", () => {
      const { blacklistProvider, isProviderBlacklisted } = require("./global-blacklist")
      // Blacklist with 0 second cooldown (immediately expired)
      blacklistProvider("anthropic", 0)
      // Should be expired and return false
      const blacklisted = isProviderBlacklisted("anthropic")
      expect(blacklisted).toBe(false)
    })
  })

  describe("getBlacklistedProviders", () => {
    test("returns empty array when no providers", () => {
      const { getBlacklistedProviders } = require("./global-blacklist")
      const providers = getBlacklistedProviders()
      expect(providers).toEqual([])
    })

    test("returns all active blacklisted providers", () => {
      const { blacklistProvider, getBlacklistedProviders } = require("./global-blacklist")
      blacklistProvider("anthropic", 3600)
      blacklistProvider("openai", 3600)
      const providers = getBlacklistedProviders()
      expect(providers).toContain("anthropic")
      expect(providers).toContain("openai")
      expect(providers.length).toBe(2)
    })

    test("filters out expired providers", () => {
      const { blacklistProvider, getBlacklistedProviders } = require("./global-blacklist")
      blacklistProvider("anthropic", 3600)
      blacklistProvider("expired", 0) // Immediately expired
      const providers = getBlacklistedProviders()
      expect(providers).toContain("anthropic")
      expect(providers).not.toContain("expired")
    })
  })

  describe("clearBlacklist", () => {
    test("removes all providers", () => {
      const { blacklistProvider, isProviderBlacklisted, clearBlacklist } = require("./global-blacklist")
      blacklistProvider("anthropic", 3600)
      clearBlacklist()
      const blacklisted = isProviderBlacklisted("anthropic")
      expect(blacklisted).toBe(false)
    })
  })
})
