import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import * as fs from "node:fs"
import * as os from "node:os"
import * as path from "node:path"
import { findPluginEntry } from "./plugin-entry"

describe("findPluginEntry", () => {
  let temporaryDirectory: string
  let configPath: string

  beforeEach(() => {
    temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "omo-plugin-entry-test-"))
    const opencodeDirectory = path.join(temporaryDirectory, ".opencode")
    fs.mkdirSync(opencodeDirectory, { recursive: true })
    configPath = path.join(opencodeDirectory, "opencode.json")
  })

  afterEach(() => {
    fs.rmSync(temporaryDirectory, { recursive: true, force: true })
  })

  test("returns unpinned for bare package name", () => {
    // #given plugin is configured without a tag
    fs.writeFileSync(configPath, JSON.stringify({ plugin: ["oh-my-opencode"] }))

    // #when plugin entry is detected
    const pluginInfo = findPluginEntry(temporaryDirectory)

    // #then entry is not pinned
    expect(pluginInfo).not.toBeNull()
    expect(pluginInfo?.isPinned).toBe(false)
    expect(pluginInfo?.pinnedVersion).toBeNull()
  })

  test("returns unpinned for latest dist-tag", () => {
    // #given plugin is configured with latest dist-tag
    fs.writeFileSync(configPath, JSON.stringify({ plugin: ["oh-my-opencode@latest"] }))

    // #when plugin entry is detected
    const pluginInfo = findPluginEntry(temporaryDirectory)

    // #then latest is treated as channel, not pin
    expect(pluginInfo).not.toBeNull()
    expect(pluginInfo?.isPinned).toBe(false)
    expect(pluginInfo?.pinnedVersion).toBe("latest")
  })

  test("returns unpinned for beta dist-tag", () => {
    // #given plugin is configured with beta dist-tag
    fs.writeFileSync(configPath, JSON.stringify({ plugin: ["oh-my-opencode@beta"] }))

    // #when plugin entry is detected
    const pluginInfo = findPluginEntry(temporaryDirectory)

    // #then beta is treated as channel, not pin
    expect(pluginInfo).not.toBeNull()
    expect(pluginInfo?.isPinned).toBe(false)
    expect(pluginInfo?.pinnedVersion).toBe("beta")
  })

  test("returns pinned for explicit semver", () => {
    // #given plugin is configured with explicit version
    fs.writeFileSync(configPath, JSON.stringify({ plugin: ["oh-my-opencode@3.5.2"] }))

    // #when plugin entry is detected
    const pluginInfo = findPluginEntry(temporaryDirectory)

    // #then explicit semver is treated as pin
    expect(pluginInfo).not.toBeNull()
    expect(pluginInfo?.isPinned).toBe(true)
    expect(pluginInfo?.pinnedVersion).toBe("3.5.2")
  })
})
