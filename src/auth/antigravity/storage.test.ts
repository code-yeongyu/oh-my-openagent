import { describe, it, expect, beforeEach, afterEach } from "bun:test"
import { join } from "node:path"
import { homedir } from "node:os"
import { promises as fs } from "node:fs"
import { tmpdir } from "node:os"
import type { AccountStorage } from "./types"
import { getDataDir, getStoragePath, loadAccounts, saveAccounts } from "./storage"

describe("storage", () => {
  const testDir = join(tmpdir(), `oh-my-opencode-storage-test-${Date.now()}`)
  const testStoragePath = join(testDir, "oh-my-opencode-accounts.json")

  const validStorage: AccountStorage = {
    version: 1,
    accounts: [
      {
        email: "test@example.com",
        tier: "free",
        refreshToken: "refresh-token-123",
        projectId: "project-123",
        accessToken: "access-token-123",
        expiresAt: Date.now() + 3600000,
        rateLimits: {},
      },
    ],
    activeIndex: 0,
  }

  beforeEach(async () => {
    await fs.mkdir(testDir, { recursive: true })
  })

  afterEach(async () => {
    try {
      await fs.rm(testDir, { recursive: true, force: true })
    } catch {
      // ignore cleanup errors
    }
  })

  describe("getDataDir", () => {
    it("returns path containing opencode directory", () => {
      // #given
      // platform is current system

      // #when
      const result = getDataDir()

      // #then
      expect(result).toContain("opencode")
    })

    it("returns XDG_DATA_HOME/opencode when XDG_DATA_HOME is set on non-Windows", () => {
      // #given
      const originalXdg = process.env.XDG_DATA_HOME
      const originalPlatform = process.platform

      if (originalPlatform === "win32") {
        return
      }

      try {
        process.env.XDG_DATA_HOME = "/custom/data"

        // #when
        const result = getDataDir()

        // #then
        expect(result).toBe("/custom/data/opencode")
      } finally {
        if (originalXdg !== undefined) {
          process.env.XDG_DATA_HOME = originalXdg
        } else {
          delete process.env.XDG_DATA_HOME
        }
      }
    })

    it("returns ~/.local/share/opencode when XDG_DATA_HOME is not set on non-Windows", () => {
      // #given
      const originalXdg = process.env.XDG_DATA_HOME
      const originalPlatform = process.platform

      if (originalPlatform === "win32") {
        return
      }

      try {
        delete process.env.XDG_DATA_HOME

        // #when
        const result = getDataDir()

        // #then
        expect(result).toBe(join(homedir(), ".local", "share", "opencode"))
      } finally {
        if (originalXdg !== undefined) {
          process.env.XDG_DATA_HOME = originalXdg
        } else {
          delete process.env.XDG_DATA_HOME
        }
      }
    })
  })

  describe("getStoragePath", () => {
    it("returns path ending with oh-my-opencode-accounts.json", () => {
      // #given
      // no setup needed

      // #when
      const result = getStoragePath()

      // #then
      expect(result.endsWith("oh-my-opencode-accounts.json")).toBe(true)
      expect(result).toContain("opencode")
    })
  })

  describe("loadAccounts", () => {
    it("returns parsed storage when file exists and is valid", async () => {
      // #given
      await fs.writeFile(testStoragePath, JSON.stringify(validStorage), "utf-8")

      // #when
      const result = await loadAccounts(testStoragePath)

      // #then
      expect(result).not.toBeNull()
      expect(result?.version).toBe(1)
      expect(result?.accounts).toHaveLength(1)
      expect(result?.accounts[0].email).toBe("test@example.com")
    })

    it("returns null when file does not exist (ENOENT)", async () => {
      // #given
      const nonExistentPath = join(testDir, "non-existent.json")

      // #when
      const result = await loadAccounts(nonExistentPath)

      // #then
      expect(result).toBeNull()
    })

    it("returns null when file contains invalid JSON", async () => {
      // #given
      const invalidJsonPath = join(testDir, "invalid.json")
      await fs.writeFile(invalidJsonPath, "{ invalid json }", "utf-8")

      // #when
      const result = await loadAccounts(invalidJsonPath)

      // #then
      expect(result).toBeNull()
    })

    it("returns null when file contains valid JSON but invalid schema", async () => {
      // #given
      const invalidSchemaPath = join(testDir, "invalid-schema.json")
      await fs.writeFile(invalidSchemaPath, JSON.stringify({ foo: "bar" }), "utf-8")

      // #when
      const result = await loadAccounts(invalidSchemaPath)

      // #then
      expect(result).toBeNull()
    })

    it("returns null when accounts is not an array", async () => {
      // #given
      const invalidAccountsPath = join(testDir, "invalid-accounts.json")
      await fs.writeFile(
        invalidAccountsPath,
        JSON.stringify({ version: 1, accounts: "not-array", activeIndex: 0 }),
        "utf-8"
      )

      // #when
      const result = await loadAccounts(invalidAccountsPath)

      // #then
      expect(result).toBeNull()
    })

    it("returns null when activeIndex is not a number", async () => {
      // #given
      const invalidIndexPath = join(testDir, "invalid-index.json")
      await fs.writeFile(
        invalidIndexPath,
        JSON.stringify({ version: 1, accounts: [], activeIndex: "zero" }),
        "utf-8"
      )

      // #when
      const result = await loadAccounts(invalidIndexPath)

      // #then
      expect(result).toBeNull()
    })
  })

  describe("saveAccounts", () => {
    it("writes storage to file with proper JSON formatting", async () => {
      // #given
      // testStoragePath is ready

      // #when
      await saveAccounts(validStorage, testStoragePath)

      // #then
      const content = await fs.readFile(testStoragePath, "utf-8")
      const parsed = JSON.parse(content)
      expect(parsed.version).toBe(1)
      expect(parsed.accounts).toHaveLength(1)
      expect(parsed.activeIndex).toBe(0)
    })

    it("creates parent directories if they do not exist", async () => {
      // #given
      const nestedPath = join(testDir, "nested", "deep", "oh-my-opencode-accounts.json")

      // #when
      await saveAccounts(validStorage, nestedPath)

      // #then
      const content = await fs.readFile(nestedPath, "utf-8")
      const parsed = JSON.parse(content)
      expect(parsed.version).toBe(1)
    })

    it("overwrites existing file", async () => {
      // #given
      const existingStorage: AccountStorage = {
        version: 1,
        accounts: [],
        activeIndex: 0,
      }
      await fs.writeFile(testStoragePath, JSON.stringify(existingStorage), "utf-8")

      // #when
      await saveAccounts(validStorage, testStoragePath)

      // #then
      const content = await fs.readFile(testStoragePath, "utf-8")
      const parsed = JSON.parse(content)
      expect(parsed.accounts).toHaveLength(1)
    })

    it("uses pretty-printed JSON with 2-space indentation", async () => {
      // #given
      // testStoragePath is ready

      // #when
      await saveAccounts(validStorage, testStoragePath)

      // #then
      const content = await fs.readFile(testStoragePath, "utf-8")
      expect(content).toContain("\n")
      expect(content).toContain("  ")
    })
  })
})
