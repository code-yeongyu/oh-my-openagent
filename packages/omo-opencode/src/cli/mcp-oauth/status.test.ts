import { afterEach, beforeEach, describe, expect, it, spyOn } from "bun:test"
import { existsSync, mkdirSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { saveToken } from "../../features/mcp-oauth/storage"
import { status } from "./status"

describe("status command", () => {
  const testConfigDirectory = join(tmpdir(), `mcp-oauth-status-test-${Date.now()}`)
  let originalConfigDirectory: string | undefined
  let consoleLogSpy: ReturnType<typeof spyOn>

  beforeEach(() => {
    originalConfigDirectory = process.env.OPENCODE_CONFIG_DIR
    process.env.OPENCODE_CONFIG_DIR = testConfigDirectory
    consoleLogSpy = spyOn(console, "log").mockImplementation(() => {})
    if (!existsSync(testConfigDirectory)) {
      mkdirSync(testConfigDirectory, { recursive: true })
    }
  })

  afterEach(() => {
    if (originalConfigDirectory === undefined) {
      delete process.env.OPENCODE_CONFIG_DIR
    } else {
      process.env.OPENCODE_CONFIG_DIR = originalConfigDirectory
    }
    if (existsSync(testConfigDirectory)) {
      rmSync(testConfigDirectory, { recursive: true, force: true })
    }
    consoleLogSpy.mockRestore()
  })

  it("returns success code when checking status for specific server", async () => {
    // given
    const serverName = "test-server"

    // when
    const exitCode = await status(serverName)

    // then
    expect(typeof exitCode).toBe("number")
    expect(exitCode).toBe(0)
  })

  it("returns success code when checking status for all servers", async () => {
    // given
    const serverName = undefined

    // when
    const exitCode = await status(serverName)

    // then
    expect(typeof exitCode).toBe("number")
    expect(exitCode).toBe(0)
  })

  it("handles non-existent server gracefully", async () => {
    // given
    const serverName = "non-existent-server"

    // when
    const exitCode = await status(serverName)

    // then
    expect(typeof exitCode).toBe("number")
    expect(exitCode).toBe(0)
  })

  it("lists a URL-keyed token for the supplied server name", async () => {
    // given
    const serverName = "github"
    const serverUrl = "https://oauth.example.test/mcp"
    saveToken(serverUrl, serverUrl, { accessToken: "test-token" })

    // when
    const exitCode = await status(serverName, { serverUrl })

    // then
    expect(exitCode).toBe(0)
    expect(consoleLogSpy).toHaveBeenCalledWith(`OAuth Status for ${serverName}:`)
    expect(consoleLogSpy).not.toHaveBeenCalledWith(`No tokens found for ${serverName}`)
  })
})
