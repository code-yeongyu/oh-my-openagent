import { describe, expect, test, beforeEach } from "bun:test"
import * as fs from "fs/promises"
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
  beforeEach(async () => {
    await clearBlacklist()
  })

  describe("blacklistProvider", () => {
    test("adds provider to blacklist", async () => {
      await blacklistProvider("anthropic", 3600, "Rate limit")
      const blacklisted = await isProviderBlacklisted("anthropic")
      expect(blacklisted).toBe(true)
    })

    test("sets correct expiry time", async () => {
      const cooldownSeconds = 60
      const before = Date.now()
      await blacklistProvider("openai", cooldownSeconds)
      const content = await fs.readFile(BLACKLIST_FILE, "utf-8")
      const data = JSON.parse(content)
      const expiresAt = data.providers.openai.expiresAt
      expect(expiresAt).toBeGreaterThanOrEqual(before + (cooldownSeconds * 1000))
    })
  })

  describe("isProviderBlacklisted", () => {
    test("returns false for non-blacklisted provider", async () => {
      expect(await isProviderBlacklisted("anthropic")).toBe(false)
    })

    test("returns true for blacklisted provider", async () => {
      await blacklistProvider("anthropic", 3600)
      expect(await isProviderBlacklisted("anthropic")).toBe(true)
    })

    test("returns false after expiry", async () => {
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
      await fs.mkdir(path.dirname(BLACKLIST_FILE), { recursive: true })
      await fs.writeFile(BLACKLIST_FILE, JSON.stringify(blacklist))
      expect(await isProviderBlacklisted("anthropic")).toBe(false)
    })
  })

  describe("getBlacklistedProviders", () => {
    test("returns empty array when no providers blacklisted", async () => {
      expect(await getBlacklistedProviders()).toEqual([])
    })

    test("returns active blacklisted providers", async () => {
      await blacklistProvider("anthropic", 3600)
      await blacklistProvider("openai", 3600)
      const providers = await getBlacklistedProviders()
      expect(providers).toContain("anthropic")
      expect(providers).toContain("openai")
    })
  })
})
