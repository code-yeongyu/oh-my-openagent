const { afterEach, beforeEach, describe, expect, mock, test } = require("bun:test")
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

const { clearClaudeHooksConfigCache, loadClaudeHooksConfig } = await import("./config")

describe("loadClaudeHooksConfig", () => {
  const originalDateNow = Date.now
  let originalWorkingDirectory = ""
  let tempDirectory = ""
  let customSettingsPath = ""
  let mockedNow = 0

  beforeEach(() => {
    //#given
    originalWorkingDirectory = process.cwd()
    tempDirectory = mkdtempSync(join(tmpdir(), "omo-claude-hooks-config-"))
    customSettingsPath = join(tempDirectory, "custom-settings.json")
    mkdirSync(join(tempDirectory, ".claude"), { recursive: true })
    process.chdir(tempDirectory)
    mockedNow = 1_000
    Date.now = () => mockedNow
    clearClaudeHooksConfigCache()
  })

  afterEach(() => {
    clearClaudeHooksConfigCache()
    Date.now = originalDateNow
    process.chdir(originalWorkingDirectory)
    rmSync(tempDirectory, { recursive: true, force: true })
  })

  test("#given cached hook config #when file changes within ttl #then cached value is reused", async () => {
    //#given
    writeSettingsFile(customSettingsPath, "first-stop-command")

    //#when
    const firstResult = await loadClaudeHooksConfig(customSettingsPath)
    writeSettingsFile(customSettingsPath, "second-stop-command")
    mockedNow += 5_000
    const secondResult = await loadClaudeHooksConfig(customSettingsPath)

    //#then
    expect(getStopCommands(firstResult)).toContain("first-stop-command")
    expect(getStopCommands(secondResult)).toContain("first-stop-command")
    expect(getStopCommands(secondResult)).not.toContain("second-stop-command")
  })

  test("#given cached hook config #when ttl expires or cache clears #then updated file contents are reloaded", async () => {
    //#given
    writeSettingsFile(customSettingsPath, "first-stop-command")
    await loadClaudeHooksConfig(customSettingsPath)

    //#when
    writeSettingsFile(customSettingsPath, "second-stop-command")
    mockedNow += 31_000
    const ttlReloaded = await loadClaudeHooksConfig(customSettingsPath)

    writeSettingsFile(customSettingsPath, "third-stop-command")
    clearClaudeHooksConfigCache()
    const manuallyReloaded = await loadClaudeHooksConfig(customSettingsPath)

    //#then
    expect(getStopCommands(ttlReloaded)).toContain("second-stop-command")
    expect(getStopCommands(ttlReloaded)).not.toContain("first-stop-command")
    expect(getStopCommands(manuallyReloaded)).toContain("third-stop-command")
    expect(getStopCommands(manuallyReloaded)).not.toContain("second-stop-command")
  })
})

function writeSettingsFile(filePath: string, command: string): void {
  writeFileSync(
    filePath,
    JSON.stringify({
      hooks: {
        Stop: [
          {
            matcher: "*",
            hooks: [{ command }],
          },
        ],
      },
    }),
  )
}

function getStopCommands(config: Awaited<ReturnType<typeof loadClaudeHooksConfig>>): string[] {
  return (config?.Stop ?? []).flatMap((matcher) =>
    matcher.hooks.flatMap((hook) =>
      "command" in hook && typeof hook.command === "string" ? [hook.command] : [],
    ),
  )
}

export {}
