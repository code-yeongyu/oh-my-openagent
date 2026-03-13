import { describe, expect, test, beforeEach } from "bun:test"
import * as fs from "fs"
import * as path from "path"
import { homedir } from "os"
import { 
  blacklistProvider, 
  isProviderBlacklisted, 
  getBlacklistedProviders,
  clearBlacklist 
} from "./global-blacklist"

const BLACKLIST_FILE = path.join(homedir(), ".cache", "opencode", "provider-blacklist.json")

describe("global-blacklist", () => {
  beforeEach(() => {
    clearBlacklist()
  })

  describe("blacklistProvider", () => {
    test("adds provider to blacklist", () => {
      blacklistProvider("anthropic", 3600, "Rate limit")
      const blacklisted = isProviderBlacklisted("anthropic")
      expect(blacklisted).toBe(true)
    })

    test("sets correct expiry time", () => {
      const cooldownSeconds = 60
      const before = Date.now()
      blacklistProvider("openai", cooldownSeconds)
      const content = fs.readFileSync(BLACKLIST_FILE, "utf-8")
      const data = JSON.parse(content)
      const expiresAt = data.providers.openai.expiresAt
      expect(expiresAt).toBeGreaterThanOrEqual(before + (cooldownSeconds * 1000))
    })
  })

  describe("isProviderBlacklisted", () => {
    test("returns false for non-blacklisted provider", () => {
      expect(isProviderBlacklisted("anthropic")).toBe(false)
    })

    test("returns true for blacklisted provider", () => {
      blacklistProvider("anthropic", 3600)
      expect(isProviderBlacklisted("anthropic")).toBe(true)
    })

    test("returns false after expiry", () => {
      const blacklist = {
        providers: {
          anthropic: {
            providerID: "anthropic",
            blacklistedAt: Date.now() - 2000,
            reason: "Test",
            expiresAt: Date.now() - 1000
          }
        },
        updatedAt: Date.now()
      }
      fs.mkdirSync(path.dirname(BLACKLIST_FILE), { recursive: true })
      fs.writeFileSync(BLACKLIST_FILE, JSON.stringify(blacklist))
      expect(isProviderBlacklisted("anthropic")).toBe(false)
    })
  })

  describe("getBlacklistedProviders", () => {
    test("returns empty array when no providers blacklisted", () => {
      expect(getBlacklistedProviders()).toEqual([])
    })

    test("returns active blacklisted providers", () => {
      blacklistProvider("anthropic", 3600)
      blacklistProvider("openai", 3600)
      const providers = getBlacklistedProviders()
      expect(providers).toContain("anthropic")
      expect(providers).toContain("openai")
    })
  })
})
