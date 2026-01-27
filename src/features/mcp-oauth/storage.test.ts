import { describe, expect, test, beforeEach, afterEach } from "bun:test"
import { existsSync, mkdirSync, rmSync, readFileSync, statSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { tmpdir } from "node:os"
import {
  deleteToken,
  getMcpOauthStoragePath,
  listAllTokens,
  listTokensByHost,
  loadToken,
  saveToken,
} from "./storage"
import type { OAuthTokenData } from "./storage"

describe("mcp-oauth storage", () => {
  const TEST_CONFIG_DIR = join(tmpdir(), "mcp-oauth-test-" + Date.now())
  let originalConfigDir: string | undefined

  beforeEach(() => {
    originalConfigDir = process.env.OPENCODE_CONFIG_DIR
    process.env.OPENCODE_CONFIG_DIR = TEST_CONFIG_DIR
    if (!existsSync(TEST_CONFIG_DIR)) {
      mkdirSync(TEST_CONFIG_DIR, { recursive: true })
    }
  })

  afterEach(() => {
    if (originalConfigDir === undefined) {
      delete process.env.OPENCODE_CONFIG_DIR
    } else {
      process.env.OPENCODE_CONFIG_DIR = originalConfigDir
    }
    if (existsSync(TEST_CONFIG_DIR)) {
      rmSync(TEST_CONFIG_DIR, { recursive: true, force: true })
    }
  })

  test("should save tokens with {host}/{resource} key and set 0600 permissions", () => {
    // #given
    const token: OAuthTokenData = {
      accessToken: "access-1",
      refreshToken: "refresh-1",
      expiresAt: 1710000000,
      clientInfo: { clientId: "client-1", clientSecret: "secret-1" },
    }

    // #when
    const success = saveToken("https://example.com:443", "mcp/v1", token)
    const storagePath = getMcpOauthStoragePath()
    const parsed = JSON.parse(readFileSync(storagePath, "utf-8")) as Record<string, OAuthTokenData>
    const mode = statSync(storagePath).mode & 0o777

    // #then
    expect(success).toBe(true)
    expect(Object.keys(parsed)).toEqual(["example.com/mcp/v1"])
    expect(parsed["example.com/mcp/v1"].accessToken).toBe("access-1")
    expect(mode).toBe(0o600)
  })

  test("should load a saved token", () => {
    // #given
    const token: OAuthTokenData = { accessToken: "access-2", refreshToken: "refresh-2" }
    saveToken("api.example.com", "resource-a", token)

    // #when
    const loaded = loadToken("api.example.com:8443", "resource-a")

    // #then
    expect(loaded).toEqual(token)
  })

  test("should delete a token", () => {
    // #given
    const token: OAuthTokenData = { accessToken: "access-3" }
    saveToken("api.example.com", "resource-b", token)

    // #when
    const success = deleteToken("api.example.com", "resource-b")
    const loaded = loadToken("api.example.com", "resource-b")

    // #then
    expect(success).toBe(true)
    expect(loaded).toBeNull()
  })

  test("should list tokens by host", () => {
    // #given
    saveToken("api.example.com", "resource-a", { accessToken: "access-a" })
    saveToken("api.example.com", "resource-b", { accessToken: "access-b" })
    saveToken("other.example.com", "resource-c", { accessToken: "access-c" })

    // #when
    const entries = listTokensByHost("api.example.com:5555")

    // #then
    expect(Object.keys(entries).sort()).toEqual([
      "api.example.com/resource-a",
      "api.example.com/resource-b",
    ])
    expect(entries["api.example.com/resource-a"].accessToken).toBe("access-a")
  })

  test("should handle missing storage file", () => {
    // #given
    const storagePath = getMcpOauthStoragePath()
    if (existsSync(storagePath)) {
      rmSync(storagePath, { force: true })
    }

    // #when
    const loaded = loadToken("api.example.com", "resource-a")
    const entries = listTokensByHost("api.example.com")

    // #then
    expect(loaded).toBeNull()
    expect(entries).toEqual({})
  })

  test("should handle invalid JSON", () => {
    // #given
    const storagePath = getMcpOauthStoragePath()
    const dir = join(storagePath, "..")
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true })
    }
    writeFileSync(storagePath, "{not-valid-json", "utf-8")

    // #when
    const loaded = loadToken("api.example.com", "resource-a")
    const entries = listTokensByHost("api.example.com")

    // #then
    expect(loaded).toBeNull()
    expect(entries).toEqual({})
  })
})
