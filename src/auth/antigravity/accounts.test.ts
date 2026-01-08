import { describe, it, expect, beforeEach, afterEach } from "bun:test"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { promises as fs } from "node:fs"
import { AccountManager, type ManagedAccount } from "./accounts"
import type {
  AccountStorage,
  AccountMetadata,
  ModelFamily,
  AccountTier,
  AntigravityRefreshParts,
  RateLimitState,
} from "./types"

// #region Test Fixtures

interface MockAuthDetails {
  refresh: string
  access: string
  expires: number
}

function createMockAuthDetails(refresh = "refresh-token|project-id|managed-id"): MockAuthDetails {
  return {
    refresh,
    access: "access-token",
    expires: Date.now() + 3600000,
  }
}

function createMockAccountMetadata(overrides: Partial<AccountMetadata> = {}): AccountMetadata {
  return {
    email: "test@example.com",
    tier: "free" as AccountTier,
    refreshToken: "refresh-token",
    projectId: "project-id",
    managedProjectId: "managed-id",
    accessToken: "access-token",
    expiresAt: Date.now() + 3600000,
    rateLimits: {},
    ...overrides,
  }
}

function createMockAccountStorage(accounts: AccountMetadata[], activeIndex = 0): AccountStorage {
  return {
    version: 1,
    accounts,
    activeIndex,
  }
}

// #endregion

describe("AccountManager", () => {
  let testDir: string

  beforeEach(async () => {
    testDir = join(tmpdir(), `accounts-test-${Date.now()}-${Math.random().toString(36).slice(2)}`)
    await fs.mkdir(testDir, { recursive: true })
  })

  afterEach(async () => {
    try {
      await fs.rm(testDir, { recursive: true, force: true })
    } catch {
      // Ignore cleanup errors
    }
  })

  describe("constructor", () => {
    it("should initialize from stored accounts", () => {
      // #given
      const storedAccounts = createMockAccountStorage(
        [
          createMockAccountMetadata({ email: "user1@example.com", tier: "paid" }),
          createMockAccountMetadata({ email: "user2@example.com", tier: "free" }),
        ],
        1
      )
      const auth = createMockAuthDetails()

      // #when
      const manager = new AccountManager(auth, storedAccounts)

      // #then
      expect(manager.getAccountCount()).toBe(2)
      const current = manager.getCurrentAccount()
      expect(current).not.toBeNull()
      expect(current?.email).toBe("user2@example.com")
    })

    it("should initialize from single auth token when no stored accounts", () => {
      // #given
      const auth = createMockAuthDetails("refresh-token|project-id|managed-id")

      // #when
      const manager = new AccountManager(auth, null)

      // #then
      expect(manager.getAccountCount()).toBe(1)
      const current = manager.getCurrentAccount()
      expect(current).not.toBeNull()
      expect(current?.parts.refreshToken).toBe("refresh-token")
      expect(current?.parts.projectId).toBe("project-id")
      expect(current?.parts.managedProjectId).toBe("managed-id")
    })

    it("should handle empty stored accounts by falling back to auth token", () => {
      // #given
      const storedAccounts = createMockAccountStorage([], 0)
      const auth = createMockAuthDetails("single-refresh|single-project")

      // #when
      const manager = new AccountManager(auth, storedAccounts)

      // #then
      expect(manager.getAccountCount()).toBe(1)
      const current = manager.getCurrentAccount()
      expect(current?.parts.refreshToken).toBe("single-refresh")
    })

    it("should use auth tokens for active account and restore stored tokens for others", () => {
      // #given
      const storedAccounts = createMockAccountStorage(
        [
          createMockAccountMetadata({ email: "user1@example.com", accessToken: "stored-token-1" }),
          createMockAccountMetadata({ email: "user2@example.com", accessToken: "stored-token-2" }),
        ],
        1
      )
      const auth = createMockAuthDetails()

      // #when
      const manager = new AccountManager(auth, storedAccounts)

      // #then
      const accounts = manager.getAccounts()
      expect(accounts[0]?.access).toBe("stored-token-1")
      expect(accounts[1]?.access).toBe("access-token")
    })
  })

  describe("getCurrentAccount", () => {
    it("should return current active account", () => {
      // #given
      const storedAccounts = createMockAccountStorage(
        [
          createMockAccountMetadata({ email: "user1@example.com" }),
          createMockAccountMetadata({ email: "user2@example.com" }),
        ],
        0
      )
      const auth = createMockAuthDetails()
      const manager = new AccountManager(auth, storedAccounts)

      // #when
      const current = manager.getCurrentAccount()

      // #then
      expect(current).not.toBeNull()
      expect(current?.email).toBe("user1@example.com")
    })

    it("should return null when no accounts exist", () => {
      // #given
      const auth = createMockAuthDetails()
      const manager = new AccountManager(auth, null)
      while (manager.getAccountCount() > 0) {
        manager.removeAccount(0)
      }

      // #when
      const current = manager.getCurrentAccount()

      // #then
      expect(current).toBeNull()
    })
  })

  describe("getCurrentOrNextForFamily", () => {
    it("should return current account if not rate limited", () => {
      // #given
      const storedAccounts = createMockAccountStorage(
        [createMockAccountMetadata({ email: "user1@example.com", tier: "free" })],
        0
      )
      const auth = createMockAuthDetails()
      const manager = new AccountManager(auth, storedAccounts)

      // #when
      const account = manager.getCurrentOrNextForFamily("claude")

      // #then
      expect(account).not.toBeNull()
      expect(account?.email).toBe("user1@example.com")
    })

    it("should rotate to next account if current is rate limited", () => {
      // #given
      const storedAccounts = createMockAccountStorage(
        [
          createMockAccountMetadata({ email: "user1@example.com", tier: "free" }),
          createMockAccountMetadata({ email: "user2@example.com", tier: "free" }),
        ],
        0
      )
      const auth = createMockAuthDetails()
      const manager = new AccountManager(auth, storedAccounts)
      const current = manager.getCurrentAccount()!
      manager.markRateLimited(current, 60000, "claude")

      // #when
      const account = manager.getCurrentOrNextForFamily("claude")

      // #then
      expect(account).not.toBeNull()
      expect(account?.email).toBe("user2@example.com")
    })

    it("should prioritize paid tier over free tier", () => {
      // #given
      const storedAccounts = createMockAccountStorage(
        [
          createMockAccountMetadata({ email: "free@example.com", tier: "free" }),
          createMockAccountMetadata({ email: "paid@example.com", tier: "paid" }),
        ],
        0
      )
      const auth = createMockAuthDetails()
      const manager = new AccountManager(auth, storedAccounts)

      // #when
      const account = manager.getCurrentOrNextForFamily("claude")

      // #then
      expect(account).not.toBeNull()
      expect(account?.email).toBe("paid@example.com")
      expect(account?.tier).toBe("paid")
    })

    it("should stay with current paid account even if free accounts available", () => {
      // #given
      const storedAccounts = createMockAccountStorage(
        [
          createMockAccountMetadata({ email: "paid@example.com", tier: "paid" }),
          createMockAccountMetadata({ email: "free@example.com", tier: "free" }),
        ],
        0
      )
      const auth = createMockAuthDetails()
      const manager = new AccountManager(auth, storedAccounts)

      // #when
      const account = manager.getCurrentOrNextForFamily("claude")

      // #then
      expect(account?.email).toBe("paid@example.com")
    })

    it("should return null when all accounts are rate limited", () => {
      // #given
      const storedAccounts = createMockAccountStorage(
        [
          createMockAccountMetadata({ email: "user1@example.com" }),
          createMockAccountMetadata({ email: "user2@example.com" }),
        ],
        0
      )
      const auth = createMockAuthDetails()
      const manager = new AccountManager(auth, storedAccounts)
      const accounts = manager.getAccounts()
      for (const acc of accounts) {
        manager.markRateLimited(acc, 60000, "claude")
      }

      // #when
      const account = manager.getCurrentOrNextForFamily("claude")

      // #then
      expect(account).toBeNull()
    })

    it("should update lastUsed timestamp when returning account", () => {
      // #given
      const storedAccounts = createMockAccountStorage(
        [createMockAccountMetadata({ email: "user1@example.com" })],
        0
      )
      const auth = createMockAuthDetails()
      const manager = new AccountManager(auth, storedAccounts)
      const before = Date.now()

      // #when
      const account = manager.getCurrentOrNextForFamily("claude")

      // #then
      expect(account?.lastUsed).toBeGreaterThanOrEqual(before)
    })

    it("should handle different model families independently", () => {
      // #given
      const storedAccounts = createMockAccountStorage(
        [
          createMockAccountMetadata({ email: "user1@example.com" }),
          createMockAccountMetadata({ email: "user2@example.com" }),
        ],
        0
      )
      const auth = createMockAuthDetails()
      const manager = new AccountManager(auth, storedAccounts)
      const current = manager.getCurrentAccount()!
      manager.markRateLimited(current, 60000, "claude")

      // #when - get account for claude (should rotate)
      const claudeAccount = manager.getCurrentOrNextForFamily("claude")

      // Reset to first account for gemini test
      const manager2 = new AccountManager(auth, storedAccounts)
      const current2 = manager2.getCurrentAccount()!
      manager2.markRateLimited(current2, 60000, "claude")
      const geminiAccount = manager2.getCurrentOrNextForFamily("gemini-flash")

      // #then
      expect(claudeAccount?.email).toBe("user2@example.com")
      expect(geminiAccount?.email).toBe("user1@example.com")
    })
  })

  describe("markRateLimited", () => {
    it("should set rate limit reset time for specified family", () => {
      // #given
      const auth = createMockAuthDetails()
      const manager = new AccountManager(auth, null)
      const account = manager.getCurrentAccount()!
      const retryAfterMs = 60000

      // #when
      manager.markRateLimited(account, retryAfterMs, "claude")

      // #then
      expect(account.rateLimits.claude).toBeGreaterThan(Date.now())
      expect(account.rateLimits.claude).toBeLessThanOrEqual(Date.now() + retryAfterMs + 100)
    })

    it("should set rate limits independently per family", () => {
      // #given
      const auth = createMockAuthDetails()
      const manager = new AccountManager(auth, null)
      const account = manager.getCurrentAccount()!

      // #when
      manager.markRateLimited(account, 30000, "claude")
      manager.markRateLimited(account, 60000, "gemini-flash")

      // #then
      expect(account.rateLimits.claude).toBeDefined()
      expect(account.rateLimits["gemini-flash"]).toBeDefined()
      expect(account.rateLimits["gemini-flash"]! - account.rateLimits.claude!).toBeGreaterThan(25000)
    })
  })

  describe("clearExpiredRateLimits", () => {
    it("should clear expired rate limits", () => {
      // #given
      const auth = createMockAuthDetails()
      const manager = new AccountManager(auth, null)
      const account = manager.getCurrentAccount()!
      account.rateLimits.claude = Date.now() - 1000

      // #when
      manager.clearExpiredRateLimits(account)

      // #then
      expect(account.rateLimits.claude).toBeUndefined()
    })

    it("should keep non-expired rate limits", () => {
      // #given
      const auth = createMockAuthDetails()
      const manager = new AccountManager(auth, null)
      const account = manager.getCurrentAccount()!
      const futureTime = Date.now() + 60000
      account.rateLimits.claude = futureTime

      // #when
      manager.clearExpiredRateLimits(account)

      // #then
      expect(account.rateLimits.claude).toBe(futureTime)
    })

    it("should clear multiple expired limits at once", () => {
      // #given
      const auth = createMockAuthDetails()
      const manager = new AccountManager(auth, null)
      const account = manager.getCurrentAccount()!
      account.rateLimits.claude = Date.now() - 1000
      account.rateLimits["gemini-flash"] = Date.now() - 500
      account.rateLimits["gemini-pro"] = Date.now() + 60000

      // #when
      manager.clearExpiredRateLimits(account)

      // #then
      expect(account.rateLimits.claude).toBeUndefined()
      expect(account.rateLimits["gemini-flash"]).toBeUndefined()
      expect(account.rateLimits["gemini-pro"]).toBeDefined()
    })
  })

  describe("addAccount", () => {
    it("should append new account to accounts array", () => {
      // #given
      const auth = createMockAuthDetails()
      const manager = new AccountManager(auth, null)
      const initialCount = manager.getAccountCount()
      const newParts: AntigravityRefreshParts = {
        refreshToken: "new-refresh",
        projectId: "new-project",
        managedProjectId: "new-managed",
      }

      // #when
      manager.addAccount(newParts, "new-access", Date.now() + 3600000, "new@example.com", "paid")

      // #then
      expect(manager.getAccountCount()).toBe(initialCount + 1)
      const accounts = manager.getAccounts()
      const newAccount = accounts[accounts.length - 1]
      expect(newAccount?.email).toBe("new@example.com")
      expect(newAccount?.tier).toBe("paid")
      expect(newAccount?.parts.refreshToken).toBe("new-refresh")
    })

    it("should set correct index for new account", () => {
      // #given
      const storedAccounts = createMockAccountStorage(
        [
          createMockAccountMetadata({ email: "user1@example.com" }),
          createMockAccountMetadata({ email: "user2@example.com" }),
        ],
        0
      )
      const auth = createMockAuthDetails()
      const manager = new AccountManager(auth, storedAccounts)
      const newParts: AntigravityRefreshParts = {
        refreshToken: "new-refresh",
        projectId: "new-project",
      }

      // #when
      manager.addAccount(newParts, "access", Date.now(), "new@example.com", "free")

      // #then
      const accounts = manager.getAccounts()
      expect(accounts[2]?.index).toBe(2)
    })

    it("should initialize new account with empty rate limits", () => {
      // #given
      const auth = createMockAuthDetails()
      const manager = new AccountManager(auth, null)
      const newParts: AntigravityRefreshParts = {
        refreshToken: "new-refresh",
        projectId: "new-project",
      }

      // #when
      manager.addAccount(newParts, "access", Date.now(), "new@example.com", "free")

      // #then
      const accounts = manager.getAccounts()
      const newAccount = accounts[accounts.length - 1]
      expect(newAccount?.rateLimits).toEqual({})
    })
  })

  describe("removeAccount", () => {
    it("should remove account by index", () => {
      // #given
      const storedAccounts = createMockAccountStorage(
        [
          createMockAccountMetadata({ email: "user1@example.com" }),
          createMockAccountMetadata({ email: "user2@example.com" }),
          createMockAccountMetadata({ email: "user3@example.com" }),
        ],
        0
      )
      const auth = createMockAuthDetails()
      const manager = new AccountManager(auth, storedAccounts)

      // #when
      const result = manager.removeAccount(1)

      // #then
      expect(result).toBe(true)
      expect(manager.getAccountCount()).toBe(2)
      const accounts = manager.getAccounts()
      expect(accounts.map((a) => a.email)).toEqual(["user1@example.com", "user3@example.com"])
    })

    it("should re-index remaining accounts after removal", () => {
      // #given
      const storedAccounts = createMockAccountStorage(
        [
          createMockAccountMetadata({ email: "user1@example.com" }),
          createMockAccountMetadata({ email: "user2@example.com" }),
          createMockAccountMetadata({ email: "user3@example.com" }),
        ],
        0
      )
      const auth = createMockAuthDetails()
      const manager = new AccountManager(auth, storedAccounts)

      // #when
      manager.removeAccount(0)

      // #then
      const accounts = manager.getAccounts()
      expect(accounts[0]?.index).toBe(0)
      expect(accounts[1]?.index).toBe(1)
    })

    it("should return false for invalid index", () => {
      // #given
      const auth = createMockAuthDetails()
      const manager = new AccountManager(auth, null)

      // #when
      const result = manager.removeAccount(999)

      // #then
      expect(result).toBe(false)
    })

    it("should return false for negative index", () => {
      // #given
      const auth = createMockAuthDetails()
      const manager = new AccountManager(auth, null)

      // #when
      const result = manager.removeAccount(-1)

      // #then
      expect(result).toBe(false)
    })
  })

  describe("save", () => {
    it("should persist accounts to storage", async () => {
      // #given
      const storagePath = join(testDir, "accounts.json")
      const storedAccounts = createMockAccountStorage(
        [createMockAccountMetadata({ email: "user1@example.com", tier: "paid" })],
        0
      )
      const auth = createMockAuthDetails()
      const manager = new AccountManager(auth, storedAccounts)

      // #when
      await manager.save(storagePath)

      // #then
      const content = await fs.readFile(storagePath, "utf-8")
      const saved = JSON.parse(content) as AccountStorage
      expect(saved.version).toBe(1)
      expect(saved.accounts).toHaveLength(1)
      expect(saved.accounts[0]?.email).toBe("user1@example.com")
      expect(saved.activeIndex).toBe(0)
    })

    it("should save current activeIndex", async () => {
      // #given
      const storagePath = join(testDir, "accounts.json")
      const storedAccounts = createMockAccountStorage(
        [
          createMockAccountMetadata({ email: "user1@example.com" }),
          createMockAccountMetadata({ email: "user2@example.com" }),
        ],
        1
      )
      const auth = createMockAuthDetails()
      const manager = new AccountManager(auth, storedAccounts)

      // #when
      await manager.save(storagePath)

      // #then
      const content = await fs.readFile(storagePath, "utf-8")
      const saved = JSON.parse(content) as AccountStorage
      expect(saved.activeIndex).toBe(1)
    })

    it("should save rate limit state", async () => {
      // #given
      const storagePath = join(testDir, "accounts.json")
      const auth = createMockAuthDetails()
      const manager = new AccountManager(auth, null)
      const account = manager.getCurrentAccount()!
      const resetTime = Date.now() + 60000
      account.rateLimits.claude = resetTime

      // #when
      await manager.save(storagePath)

      // #then
      const content = await fs.readFile(storagePath, "utf-8")
      const saved = JSON.parse(content) as AccountStorage
      expect(saved.accounts[0]?.rateLimits.claude).toBe(resetTime)
    })
  })

  describe("toAuthDetails", () => {
    it("should convert current account to OAuth format", () => {
      // #given
      const storedAccounts = createMockAccountStorage(
        [
          createMockAccountMetadata({
            email: "user1@example.com",
            refreshToken: "refresh-1",
            projectId: "project-1",
            managedProjectId: "managed-1",
          }),
        ],
        0
      )
      const auth = createMockAuthDetails()
      const manager = new AccountManager(auth, storedAccounts)

      // #when
      const authDetails = manager.toAuthDetails()

      // #then
      expect(authDetails.refresh).toContain("refresh-1")
      expect(authDetails.refresh).toContain("project-1")
      expect(authDetails.access).toBe("access-token")
    })

    it("should include all accounts in refresh token", () => {
      // #given
      const storedAccounts = createMockAccountStorage(
        [
          createMockAccountMetadata({ refreshToken: "refresh-1", projectId: "project-1" }),
          createMockAccountMetadata({ refreshToken: "refresh-2", projectId: "project-2" }),
        ],
        0
      )
      const auth = createMockAuthDetails()
      const manager = new AccountManager(auth, storedAccounts)

      // #when
      const authDetails = manager.toAuthDetails()

      // #then
      expect(authDetails.refresh).toContain("refresh-1")
      expect(authDetails.refresh).toContain("refresh-2")
    })

    it("should throw error when no accounts available", () => {
      // #given
      const auth = createMockAuthDetails()
      const manager = new AccountManager(auth, null)
      while (manager.getAccountCount() > 0) {
        manager.removeAccount(0)
      }

      // #when / #then
      expect(() => manager.toAuthDetails()).toThrow("No accounts available")
    })
  })

  describe("getAccounts", () => {
    it("should return copy of accounts array", () => {
      // #given
      const storedAccounts = createMockAccountStorage(
        [createMockAccountMetadata({ email: "user1@example.com" })],
        0
      )
      const auth = createMockAuthDetails()
      const manager = new AccountManager(auth, storedAccounts)

      // #when
      const accounts = manager.getAccounts()
      accounts.push({} as ManagedAccount)

      // #then
      expect(manager.getAccountCount()).toBe(1)
    })
  })

  describe("getAccountCount", () => {
    it("should return correct count", () => {
      // #given
      const storedAccounts = createMockAccountStorage(
        [
          createMockAccountMetadata({ email: "user1@example.com" }),
          createMockAccountMetadata({ email: "user2@example.com" }),
          createMockAccountMetadata({ email: "user3@example.com" }),
        ],
        0
      )
      const auth = createMockAuthDetails()
      const manager = new AccountManager(auth, storedAccounts)

      // #when
      const count = manager.getAccountCount()

      // #then
      expect(count).toBe(3)
    })
  })

  describe("removeAccount activeIndex adjustment", () => {
    it("should adjust activeIndex when removing account before active", () => {
      // #given
      const storedAccounts = createMockAccountStorage(
        [
          createMockAccountMetadata({ email: "user1@example.com" }),
          createMockAccountMetadata({ email: "user2@example.com" }),
          createMockAccountMetadata({ email: "user3@example.com" }),
        ],
        2
      )
      const auth = createMockAuthDetails()
      const manager = new AccountManager(auth, storedAccounts)

      // #when
      manager.removeAccount(0)

      // #then
      const current = manager.getCurrentAccount()
      expect(current?.email).toBe("user3@example.com")
    })

    it("should switch to next account when removing active account", () => {
      // #given
      const storedAccounts = createMockAccountStorage(
        [
          createMockAccountMetadata({ email: "user1@example.com" }),
          createMockAccountMetadata({ email: "user2@example.com" }),
          createMockAccountMetadata({ email: "user3@example.com" }),
        ],
        1
      )
      const auth = createMockAuthDetails()
      const manager = new AccountManager(auth, storedAccounts)

      // #when
      manager.removeAccount(1)

      // #then
      const current = manager.getCurrentAccount()
      expect(current?.email).toBe("user3@example.com")
    })

    it("should not adjust activeIndex when removing account after active", () => {
      // #given
      const storedAccounts = createMockAccountStorage(
        [
          createMockAccountMetadata({ email: "user1@example.com" }),
          createMockAccountMetadata({ email: "user2@example.com" }),
          createMockAccountMetadata({ email: "user3@example.com" }),
        ],
        0
      )
      const auth = createMockAuthDetails()
      const manager = new AccountManager(auth, storedAccounts)

      // #when
      manager.removeAccount(2)

      // #then
      const current = manager.getCurrentAccount()
      expect(current?.email).toBe("user1@example.com")
    })

    it("should handle removing last remaining account", () => {
      // #given
      const storedAccounts = createMockAccountStorage(
        [createMockAccountMetadata({ email: "user1@example.com" })],
        0
      )
      const auth = createMockAuthDetails()
      const manager = new AccountManager(auth, storedAccounts)

      // #when
      manager.removeAccount(0)

      // #then
      expect(manager.getAccountCount()).toBe(0)
      expect(manager.getCurrentAccount()).toBeNull()
    })
  })

  describe("round-robin rotation", () => {
    it("should rotate through accounts in round-robin fashion", () => {
      // #given
      const storedAccounts = createMockAccountStorage(
        [
          createMockAccountMetadata({ email: "user1@example.com", tier: "free" }),
          createMockAccountMetadata({ email: "user2@example.com", tier: "free" }),
          createMockAccountMetadata({ email: "user3@example.com", tier: "free" }),
        ],
        0
      )
      const auth = createMockAuthDetails()
      const manager = new AccountManager(auth, storedAccounts)

      // #when - mark first account as rate limited and get next multiple times
      const first = manager.getCurrentAccount()!
      manager.markRateLimited(first, 60000, "claude")

      const second = manager.getCurrentOrNextForFamily("claude")
      manager.markRateLimited(second!, 60000, "claude")

      const third = manager.getCurrentOrNextForFamily("claude")

      // #then
      expect(second?.email).toBe("user2@example.com")
      expect(third?.email).toBe("user3@example.com")
    })

    it("should wrap around when reaching end of account list", () => {
      // #given
      const storedAccounts = createMockAccountStorage(
        [
          createMockAccountMetadata({ email: "user1@example.com", tier: "free" }),
          createMockAccountMetadata({ email: "user2@example.com", tier: "free" }),
        ],
        1
      )
      const auth = createMockAuthDetails()
      const manager = new AccountManager(auth, storedAccounts)

      // #when - rate limit current, then get next repeatedly
      const current = manager.getCurrentAccount()!
      manager.markRateLimited(current, 60000, "claude")
      const next = manager.getCurrentOrNextForFamily("claude")

      // #then
      expect(next?.email).toBe("user1@example.com")
    })
  })

  describe("rate limit expiry during rotation", () => {
    it("should clear expired rate limits before selecting account", () => {
      // #given
      const storedAccounts = createMockAccountStorage(
        [
          createMockAccountMetadata({ email: "user1@example.com", tier: "paid" }),
          createMockAccountMetadata({ email: "user2@example.com", tier: "free" }),
        ],
        0
      )
      const auth = createMockAuthDetails()
      const manager = new AccountManager(auth, storedAccounts)
      const paidAccount = manager.getCurrentAccount()!

      // #when - set expired rate limit on paid account
      paidAccount.rateLimits.claude = Date.now() - 1000

      const selected = manager.getCurrentOrNextForFamily("claude")

      // #then - should use paid account since limit expired
      expect(selected?.email).toBe("user1@example.com")
      expect(selected?.rateLimits.claude).toBeUndefined()
    })

    it("should not use account with future rate limit", () => {
      // #given
      const storedAccounts = createMockAccountStorage(
        [
          createMockAccountMetadata({ email: "user1@example.com", tier: "paid" }),
          createMockAccountMetadata({ email: "user2@example.com", tier: "free" }),
        ],
        0
      )
      const auth = createMockAuthDetails()
      const manager = new AccountManager(auth, storedAccounts)
      const paidAccount = manager.getCurrentAccount()!

      // #when - set future rate limit on paid account
      paidAccount.rateLimits.claude = Date.now() + 60000

      const selected = manager.getCurrentOrNextForFamily("claude")

      // #then - should use free account since paid is still limited
      expect(selected?.email).toBe("user2@example.com")
    })
  })

  describe("partial rate limiting across model families", () => {
    it("should allow account for one family while limited for another", () => {
      // #given
      const storedAccounts = createMockAccountStorage(
        [createMockAccountMetadata({ email: "user1@example.com" })],
        0
      )
      const auth = createMockAuthDetails()
      const manager = new AccountManager(auth, storedAccounts)
      const account = manager.getCurrentAccount()!

      // #when - rate limit for claude only
      manager.markRateLimited(account, 60000, "claude")

      const claudeAccount = manager.getCurrentOrNextForFamily("claude")
      const geminiAccount = manager.getCurrentOrNextForFamily("gemini-flash")

      // #then
      expect(claudeAccount).toBeNull()
      expect(geminiAccount?.email).toBe("user1@example.com")
    })

    it("should handle mixed rate limits across multiple accounts", () => {
      // #given
      const storedAccounts = createMockAccountStorage(
        [
          createMockAccountMetadata({ email: "user1@example.com" }),
          createMockAccountMetadata({ email: "user2@example.com" }),
        ],
        0
      )
      const auth = createMockAuthDetails()
      const manager = new AccountManager(auth, storedAccounts)
      const accounts = manager.getAccounts()

      // #when - user1 limited for claude, user2 limited for gemini
      manager.markRateLimited(accounts[0]!, 60000, "claude")
      manager.markRateLimited(accounts[1]!, 60000, "gemini-flash")

      const claudeAccount = manager.getCurrentOrNextForFamily("claude")
      const geminiAccount = manager.getCurrentOrNextForFamily("gemini-flash")

      // #then
      expect(claudeAccount?.email).toBe("user2@example.com")
      expect(geminiAccount?.email).toBe("user1@example.com")
    })

    it("should handle all families rate limited for an account", () => {
      // #given
      const storedAccounts = createMockAccountStorage(
        [
          createMockAccountMetadata({ email: "user1@example.com" }),
          createMockAccountMetadata({ email: "user2@example.com" }),
        ],
        0
      )
      const auth = createMockAuthDetails()
      const manager = new AccountManager(auth, storedAccounts)
      const account = manager.getCurrentAccount()!

      // #when - rate limit all families for first account
      manager.markRateLimited(account, 60000, "claude")
      manager.markRateLimited(account, 60000, "gemini-flash")
      manager.markRateLimited(account, 60000, "gemini-pro")

      // #then - should rotate to second account for all families
      expect(manager.getCurrentOrNextForFamily("claude")?.email).toBe("user2@example.com")
      expect(manager.getCurrentOrNextForFamily("gemini-flash")?.email).toBe("user2@example.com")
      expect(manager.getCurrentOrNextForFamily("gemini-pro")?.email).toBe("user2@example.com")
    })
  })

  describe("tier prioritization edge cases", () => {
    it("should use free account when all paid accounts are rate limited", () => {
      // #given
      const storedAccounts = createMockAccountStorage(
        [
          createMockAccountMetadata({ email: "paid1@example.com", tier: "paid" }),
          createMockAccountMetadata({ email: "paid2@example.com", tier: "paid" }),
          createMockAccountMetadata({ email: "free1@example.com", tier: "free" }),
        ],
        0
      )
      const auth = createMockAuthDetails()
      const manager = new AccountManager(auth, storedAccounts)
      const accounts = manager.getAccounts()

      // #when - rate limit all paid accounts
      manager.markRateLimited(accounts[0]!, 60000, "claude")
      manager.markRateLimited(accounts[1]!, 60000, "claude")

      const selected = manager.getCurrentOrNextForFamily("claude")

      // #then - should fall back to free account
      expect(selected?.email).toBe("free1@example.com")
      expect(selected?.tier).toBe("free")
    })

    it("should switch to paid account when current free and paid becomes available", () => {
      // #given
      const storedAccounts = createMockAccountStorage(
        [
          createMockAccountMetadata({ email: "free@example.com", tier: "free" }),
          createMockAccountMetadata({ email: "paid@example.com", tier: "paid" }),
        ],
        0
      )
      const auth = createMockAuthDetails()
      const manager = new AccountManager(auth, storedAccounts)

      // #when - current is free, paid is available
      const selected = manager.getCurrentOrNextForFamily("claude")

      // #then - should prefer paid account
      expect(selected?.email).toBe("paid@example.com")
    })
  })

  describe("constructor edge cases", () => {
    it("should handle invalid activeIndex in stored accounts", () => {
      // #given
      const storedAccounts = createMockAccountStorage(
        [createMockAccountMetadata({ email: "user1@example.com" })],
        999
      )
      const auth = createMockAuthDetails()

      // #when
      const manager = new AccountManager(auth, storedAccounts)

      // #then - should fall back to 0
      const current = manager.getCurrentAccount()
      expect(current?.email).toBe("user1@example.com")
    })

    it("should handle negative activeIndex", () => {
      // #given
      const storedAccounts = createMockAccountStorage(
        [createMockAccountMetadata({ email: "user1@example.com" })],
        -1
      )
      const auth = createMockAuthDetails()

      // #when
      const manager = new AccountManager(auth, storedAccounts)

      // #then - should fall back to 0
      const current = manager.getCurrentAccount()
      expect(current?.email).toBe("user1@example.com")
    })
  })
})
