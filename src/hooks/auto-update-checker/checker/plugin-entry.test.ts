import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { spawnSync } from "node:child_process"
import * as fs from "node:fs"
import * as os from "node:os"
import * as path from "node:path"
import { PACKAGE_NAME } from "../constants"

type PluginEntryResult = {
  entry: string
  isPinned: boolean
  pinnedVersion: string | null
  configPath: string
} | null

function runFindPluginEntry(
  directory: string,
  envOverrides: Record<string, string | undefined> = {},
): { status: number | null; stdout: string; stderr: string } {
  const command = [
    `import { findPluginEntry } from ${JSON.stringify("./src/hooks/auto-update-checker/checker/plugin-entry")};`,
    `const result = findPluginEntry(${JSON.stringify(directory)});`,
    "console.log(JSON.stringify(result));",
  ].join("")

  const execution = spawnSync(process.execPath, ["-e", command], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      ...envOverrides,
    },
    encoding: "utf-8",
  })

  return {
    status: execution.status,
    stdout: execution.stdout,
    stderr: execution.stderr,
  }
}

describe("findPluginEntry", () => {
  let temporaryDirectory: string
  let configPath: string
  let originalConfigDir: string | undefined

  beforeEach(() => {
    originalConfigDir = process.env.OPENCODE_CONFIG_DIR
    temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "omo-plugin-entry-test-"))
    const opencodeDirectory = path.join(temporaryDirectory, ".opencode")
    fs.mkdirSync(opencodeDirectory, { recursive: true })
    configPath = path.join(opencodeDirectory, "opencode.json")
  })

  afterEach(() => {
    if (originalConfigDir === undefined) {
      delete process.env.OPENCODE_CONFIG_DIR
    } else {
      process.env.OPENCODE_CONFIG_DIR = originalConfigDir
    }
    fs.rmSync(temporaryDirectory, { recursive: true, force: true })
  })

  test("returns unpinned for bare package name", async () => {
    // #given plugin is configured without a tag
    fs.writeFileSync(configPath, JSON.stringify({ plugin: [PACKAGE_NAME] }))

    // #when plugin entry is detected
    const execution = runFindPluginEntry(temporaryDirectory)

    // #then entry is not pinned
    expect(execution.status).toBe(0)
    const pluginInfo = JSON.parse(execution.stdout.trim()) as PluginEntryResult
    expect(pluginInfo).not.toBeNull()
    expect(pluginInfo?.isPinned).toBe(false)
    expect(pluginInfo?.pinnedVersion).toBeNull()
  })

  test("returns unpinned for latest dist-tag", async () => {
    // #given plugin is configured with latest dist-tag
    fs.writeFileSync(configPath, JSON.stringify({ plugin: [`${PACKAGE_NAME}@latest`] }))

    // #when plugin entry is detected
    const execution = runFindPluginEntry(temporaryDirectory)

    // #then latest is treated as channel, not pin
    expect(execution.status).toBe(0)
    const pluginInfo = JSON.parse(execution.stdout.trim()) as PluginEntryResult
    expect(pluginInfo).not.toBeNull()
    expect(pluginInfo?.isPinned).toBe(false)
    expect(pluginInfo?.pinnedVersion).toBe("latest")
  })

  test("returns unpinned for beta dist-tag", async () => {
    // #given plugin is configured with beta dist-tag
    fs.writeFileSync(configPath, JSON.stringify({ plugin: [`${PACKAGE_NAME}@beta`] }))

    // #when plugin entry is detected
    const execution = runFindPluginEntry(temporaryDirectory)

    // #then beta is treated as channel, not pin
    expect(execution.status).toBe(0)
    const pluginInfo = JSON.parse(execution.stdout.trim()) as PluginEntryResult
    expect(pluginInfo).not.toBeNull()
    expect(pluginInfo?.isPinned).toBe(false)
    expect(pluginInfo?.pinnedVersion).toBe("beta")
  })

  test("returns pinned for explicit semver", async () => {
    // #given plugin is configured with explicit version
    fs.writeFileSync(configPath, JSON.stringify({ plugin: [`${PACKAGE_NAME}@3.5.2`] }))

    // #when plugin entry is detected
    const execution = runFindPluginEntry(temporaryDirectory)

    // #then explicit semver is treated as pin
    expect(execution.status).toBe(0)
    const pluginInfo = JSON.parse(execution.stdout.trim()) as PluginEntryResult
    expect(pluginInfo).not.toBeNull()
    expect(pluginInfo?.isPinned).toBe(true)
    expect(pluginInfo?.pinnedVersion).toBe("3.5.2")
  })

  test("reads user config from profile dir even when OPENCODE_CONFIG_DIR changes after import", async () => {
    // #given profile-specific user config after module import
    const profileConfigDir = path.join(temporaryDirectory, "profiles", "today")
    fs.mkdirSync(profileConfigDir, { recursive: true })
    fs.writeFileSync(
      path.join(profileConfigDir, "opencode.json"),
      JSON.stringify({ plugin: [`${PACKAGE_NAME}@beta`] }),
    )

    // #when plugin entry is detected
    const execution = runFindPluginEntry(path.join(temporaryDirectory, "workspace"), {
      OPENCODE_CONFIG_DIR: profileConfigDir,
    })

    // #then profile dir is respected
    expect(execution.status).toBe(0)
    const pluginInfo = JSON.parse(execution.stdout.trim()) as PluginEntryResult
    expect(pluginInfo).not.toBeNull()
    expect(pluginInfo?.configPath).toEndWith("/profiles/today/opencode.json")
    expect(pluginInfo?.pinnedVersion).toBe("beta")
  })
})
