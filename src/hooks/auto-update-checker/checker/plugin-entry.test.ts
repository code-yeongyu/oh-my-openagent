import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import * as fs from "node:fs"
import * as os from "node:os"
import * as path from "node:path"
import { PACKAGE_NAME } from "../constants"
import { LEGACY_PLUGIN_NAME, PLUGIN_NAME } from "../../../shared/plugin-identity"
import { findPluginEntry } from "./plugin-entry"

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
  const originalValues = new Map<string, string | undefined>()
  for (const key of Object.keys(envOverrides)) {
    originalValues.set(key, process.env[key])
  }

  try {
    for (const [key, value] of Object.entries(envOverrides)) {
      if (value === undefined) {
        delete process.env[key]
      } else {
        process.env[key] = value
      }
    }

    return {
      status: 0,
      stdout: JSON.stringify(findPluginEntry(directory)),
      stderr: "",
    }
  } finally {
    for (const [key, value] of originalValues) {
      if (value === undefined) {
        delete process.env[key]
      } else {
        process.env[key] = value
      }
    }
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

  test("finds preferred plugin entry", async () => {
    // #given preferred plugin entry is configured
    fs.writeFileSync(configPath, JSON.stringify({ plugin: [PLUGIN_NAME] }))

    // #when plugin entry is detected
    const execution = runFindPluginEntry(temporaryDirectory)

    // #then preferred entry is returned
    expect(execution.status).toBe(0)
    const pluginInfo = JSON.parse(execution.stdout.trim()) as PluginEntryResult
    expect(pluginInfo?.entry).toBe(PLUGIN_NAME)
    expect(pluginInfo?.isPinned).toBe(false)
    expect(pluginInfo?.pinnedVersion).toBeNull()
  })

  test("finds legacy plugin entry", async () => {
    // #given legacy plugin entry is configured
    fs.writeFileSync(configPath, JSON.stringify({ plugin: [LEGACY_PLUGIN_NAME] }))

    // #when plugin entry is detected
    const execution = runFindPluginEntry(temporaryDirectory)

    // #then legacy entry is returned
    expect(execution.status).toBe(0)
    const pluginInfo = JSON.parse(execution.stdout.trim()) as PluginEntryResult
    expect(pluginInfo?.entry).toBe(LEGACY_PLUGIN_NAME)
    expect(pluginInfo?.isPinned).toBe(false)
    expect(pluginInfo?.pinnedVersion).toBeNull()
  })

  test("finds preferred plugin entry with pinned version", async () => {
    // #given preferred plugin entry includes semver version
    fs.writeFileSync(configPath, JSON.stringify({ plugin: [`${PLUGIN_NAME}@3.15.0`] }))

    // #when plugin entry is detected
    const execution = runFindPluginEntry(temporaryDirectory)

    // #then preferred versioned entry is returned
    expect(execution.status).toBe(0)
    const pluginInfo = JSON.parse(execution.stdout.trim()) as PluginEntryResult
    expect(pluginInfo?.entry).toBe(`${PLUGIN_NAME}@3.15.0`)
    expect(pluginInfo?.isPinned).toBe(true)
    expect(pluginInfo?.pinnedVersion).toBe("3.15.0")
  })

  test("returns null for unrelated plugin entry", async () => {
    // #given unrelated plugin entry is configured
    fs.writeFileSync(configPath, JSON.stringify({ plugin: ["some-other-plugin"] }))

    // #when plugin entry is detected
    const execution = runFindPluginEntry(temporaryDirectory)

    // #then no matching entry is returned
    expect(execution.status).toBe(0)
    const pluginInfo = JSON.parse(execution.stdout.trim()) as PluginEntryResult
    expect(pluginInfo).toBeNull()
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
