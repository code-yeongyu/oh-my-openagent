import { describe, expect, test, beforeEach, afterEach } from "bun:test"
import { createHash } from "node:crypto"
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

function expectedServerHash(serverHost: string, resource: string): string {
  return createHash("sha256").update(`${serverHost}/${resource}`).digest("hex").slice(0, 32)
}

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

  test("should save tokens in per-server hash files and set 0600 permissions", () => {
    // given
    const serverHost = "https://example.com:443"
    const resource = "mcp/v1"
    const token: OAuthTokenData = {
      accessToken: "access-1",
      refreshToken: "refresh-1",
      expiresAt: 1710000000,
      clientInfo: { clientId: "client-1", clientSecret: "secret-1" },
    }

    // when
    const success = saveToken(serverHost, resource, token)
    const storagePath = getMcpOauthStoragePath(serverHost, resource)
    const parsed = JSON.parse(readFileSync(storagePath, "utf-8")) as OAuthTokenData
    const mode = statSync(storagePath).mode & 0o777

    // then
    expect(success).toBe(true)
    expect(storagePath.endsWith(join("mcp-oauth", `${expectedServerHash("example.com", "mcp/v1")}.json`))).toBe(true)
    expect(parsed.accessToken).toBe("access-1")
    expect(parsed.refreshToken).toBe("refresh-1")
    expect(parsed.clientInfo?.clientId).toBe("client-1")
    if (process.platform !== "win32") {
      expect(mode).toBe(0o600)
    }
  })

  test("should load a saved token", () => {
    // given
    const token: OAuthTokenData = { accessToken: "access-2", refreshToken: "refresh-2" }
    saveToken("api.example.com", "resource-a", token)

    // when
    const loaded = loadToken("api.example.com:8443", "resource-a")

    // then
    expect(loaded).toEqual(token)
  })

  test("should delete a token", () => {
    // given
    const token: OAuthTokenData = { accessToken: "access-3" }
    saveToken("api.example.com", "resource-b", token)

    // when
    const success = deleteToken("api.example.com", "resource-b")
    const loaded = loadToken("api.example.com", "resource-b")

    // then
    expect(success).toBe(true)
    expect(loaded).toBeNull()
  })

  test("should list tokens by host", () => {
    // given
    saveToken("api.example.com", "resource-a", { accessToken: "access-a" })
    saveToken("api.example.com", "resource-b", { accessToken: "access-b" })
    saveToken("other.example.com", "resource-c", { accessToken: "access-c" })

    // when
    const entries = listTokensByHost("api.example.com:5555")

    // then
    expect(Object.keys(entries).sort()).toEqual([
      "api.example.com/resource-a",
      "api.example.com/resource-b",
    ])
    expect(entries["api.example.com/resource-a"].accessToken).toBe("access-a")
  })

  test("should handle missing storage file", () => {
    // given
    const storagePath = getMcpOauthStoragePath("api.example.com", "resource-a")
    if (existsSync(storagePath)) {
      rmSync(storagePath, { force: true })
    }

    // when
    const loaded = loadToken("api.example.com", "resource-a")
    const entries = listTokensByHost("api.example.com")

    // then
    expect(loaded).toBeNull()
    expect(entries).toEqual({})
  })

  test("should handle invalid JSON", () => {
    // given
    const storagePath = getMcpOauthStoragePath("api.example.com", "resource-a")
    const dir = join(storagePath, "..")
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true })
    }
    writeFileSync(storagePath, "{not-valid-json", "utf-8")

    // when
    const loaded = loadToken("api.example.com", "resource-a")
    const entries = listTokensByHost("api.example.com")

    // then
    expect(loaded).toBeNull()
    expect(entries).toEqual({})
  })
})
