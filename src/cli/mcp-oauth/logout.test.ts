import { describe, it, expect, beforeEach, afterEach, mock } from "bun:test"
import { existsSync, mkdirSync, rmSync } from "node:fs"
import { join } from "node:path"
import { tmpdir } from "node:os"
import { saveToken } from "../../features/mcp-oauth/storage"

const { logout } = await import("./logout")

describe("logout command", () => {
  const TEST_CONFIG_DIR = join(tmpdir(), "mcp-oauth-logout-test-" + Date.now())
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

  it("returns success code when logout succeeds", async () => {
    // given
    const serverUrl = "https://test-server.example.com"
    saveToken(serverUrl, serverUrl, { accessToken: "test-token" })

    // when
    const exitCode = await logout("test-server", { serverUrl })

    // then
    expect(exitCode).toBe(0)
  })

  it("handles non-existent server gracefully", async () => {
    // given
    const serverName = "non-existent-server"

    // when
    const exitCode = await logout(serverName, { serverUrl: "https://nonexistent.example.com" })

    // then
    expect(exitCode).toBe(0)
  })

  it("returns error when --server-url is not provided", async () => {
    // given
    const serverName = "test-server"

    // when
    const exitCode = await logout(serverName)

    // then
    expect(exitCode).toBe(1)
  })
})
