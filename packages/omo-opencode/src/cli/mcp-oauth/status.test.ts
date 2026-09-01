import { afterEach, beforeEach, describe, expect, it, spyOn } from "bun:test"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { saveToken } from "../../features/mcp-oauth/storage"
import { status } from "./status"

describe("status command", () => {
  let testConfigDirectory: string
  let originalConfigDirectory: string | undefined
  let consoleLogSpy: ReturnType<typeof spyOn>

  beforeEach(() => {
    originalConfigDirectory = process.env.OPENCODE_CONFIG_DIR
    testConfigDirectory = mkdtempSync(join(tmpdir(), "mcp-oauth-status-test-"))
    process.env.OPENCODE_CONFIG_DIR = testConfigDirectory
    consoleLogSpy = spyOn(console, "log").mockImplementation(() => {})
  })

  afterEach(() => {
    if (originalConfigDirectory === undefined) {
      delete process.env.OPENCODE_CONFIG_DIR
    } else {
      process.env.OPENCODE_CONFIG_DIR = originalConfigDirectory
    }
    rmSync(testConfigDirectory, { recursive: true, force: true })
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
    const tokenKey = `oauth.example.test/${serverUrl}`
    const accessToken = "fixture-access-token"
    const refreshToken = "fixture-refresh-token"
    const saved = saveToken(serverUrl, serverUrl, { accessToken, refreshToken })

    // when
    const exitCode = await status(serverName, { serverUrl })
    const output = consoleLogSpy.mock.calls.flat().join("\n")

    // then
    expect(saved).toBe(true)
    expect(exitCode).toBe(0)
    expect(consoleLogSpy).toHaveBeenCalledWith(`OAuth Status for ${serverName}:`)
    expect(consoleLogSpy).toHaveBeenCalledWith(`  ${tokenKey}:`)
    expect(output).toContain("    Access Token: [REDACTED]")
    expect(output).toContain("    Refresh Token: [REDACTED]")
    expect(output).not.toContain(accessToken)
    expect(output).not.toContain(refreshToken)
    expect(output).not.toContain(`No tokens found for ${serverName}`)
  })
})
