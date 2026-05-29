import { afterEach, beforeEach, describe, expect, it, spyOn } from "bun:test"
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { resetConfigContext } from "./config-context"
import { detectCurrentConfig } from "./detect-current-config"
import { addPluginToOpenCodeConfig } from "./add-plugin-to-opencode-config"
import * as pluginNameWithVersion from "./plugin-name-with-version"

function mockInstallReference(version: string) {
  return spyOn(pluginNameWithVersion, "resolvePluginInstallReference").mockResolvedValue({
    entry: `oh-my-openagent@${version}`,
    channel: "latest",
  })
}

describe("detectCurrentConfig - single package detection", () => {
  let testConfigDir = ""
  let testConfigPath = ""
  let testOmoConfigPath = ""

  beforeEach(() => {
    testConfigDir = join(tmpdir(), `omo-detect-config-${Date.now()}-${Math.random().toString(36).slice(2)}`)
    testConfigPath = join(testConfigDir, "opencode.json")
    testOmoConfigPath = join(testConfigDir, "oh-my-opencode.json")

    mkdirSync(testConfigDir, { recursive: true })
    process.env.OPENCODE_CONFIG_DIR = testConfigDir
    resetConfigContext()
  })

  afterEach(() => {
    rmSync(testConfigDir, { recursive: true, force: true })
    resetConfigContext()
    delete process.env.OPENCODE_CONFIG_DIR
  })

  it("detects both legacy and canonical plugin entries", () => {
    // given
    writeFileSync(testConfigPath, JSON.stringify({ plugin: ["oh-my-opencode", "oh-my-openagent@3.11.0"] }, null, 2) + "\n", "utf-8")

    // when
    const result = detectCurrentConfig()

    // then
    expect(result.isInstalled).toBe(true)
  })

  it("returns false when plugin not present with similar name", () => {
    // given
    writeFileSync(testConfigPath, JSON.stringify({ plugin: ["oh-my-openagent-extra"] }, null, 2) + "\n", "utf-8")

    // when
    const result = detectCurrentConfig()

    // then
    expect(result.isInstalled).toBe(false)
  })

  it("detects OpenCode Go from the existing omo config", () => {
    // given
    writeFileSync(testConfigPath, JSON.stringify({ plugin: ["oh-my-opencode"] }, null, 2) + "\n", "utf-8")
    writeFileSync(testOmoConfigPath, JSON.stringify({ agents: { atlas: { model: "opencode-go/kimi-k2.6" } } }, null, 2) + "\n", "utf-8")

    // when
    const result = detectCurrentConfig()

    // then
    expect(result.isInstalled).toBe(true)
    expect(result.hasOpencodeGo).toBe(true)
  })
})

describe("addPluginToOpenCodeConfig - single package writes", () => {
  let testConfigDir = ""
  let testConfigPath = ""

  beforeEach(() => {
    testConfigDir = join(tmpdir(), `omo-add-plugin-${Date.now()}-${Math.random().toString(36).slice(2)}`)
    testConfigPath = join(testConfigDir, "opencode.json")

    mkdirSync(testConfigDir, { recursive: true })
    process.env.OPENCODE_CONFIG_DIR = testConfigDir
    resetConfigContext()
  })

  afterEach(() => {
    rmSync(testConfigDir, { recursive: true, force: true })
    resetConfigContext()
    delete process.env.OPENCODE_CONFIG_DIR
  })

  it("writes canonical plugin entry for new installs", async () => {
    // given
    const resolvePluginInstallReferenceSpy = mockInstallReference("3.11.0")
    writeFileSync(testConfigPath, JSON.stringify({}, null, 2) + "\n", "utf-8")

    // when
    const result = await addPluginToOpenCodeConfig("3.11.0")

    // then
    expect(result.success).toBe(true)
    const savedConfig = JSON.parse(readFileSync(testConfigPath, "utf-8"))
    expect(savedConfig.plugin).toEqual(["oh-my-openagent@3.11.0"])
    resolvePluginInstallReferenceSpy.mockRestore()
  })

  it("upgrades a bare legacy plugin entry to canonical", async () => {
    // given
    const resolvePluginInstallReferenceSpy = mockInstallReference("3.11.0")
    writeFileSync(testConfigPath, JSON.stringify({ plugin: ["oh-my-opencode"] }, null, 2) + "\n", "utf-8")

    // when
    const result = await addPluginToOpenCodeConfig("3.11.0")

    // then
    expect(result.success).toBe(true)
    const savedConfig = JSON.parse(readFileSync(testConfigPath, "utf-8"))
    expect(savedConfig.plugin).toEqual(["oh-my-openagent@3.11.0"])
    resolvePluginInstallReferenceSpy.mockRestore()
  })

  it("updates a version-pinned legacy entry to the requested version", async () => {
    // given
    const resolvePluginInstallReferenceSpy = spyOn(pluginNameWithVersion, "resolvePluginInstallReference").mockResolvedValue({
      entry: "oh-my-openagent@3.16.0",
      channel: "latest",
    })
    writeFileSync(testConfigPath, JSON.stringify({ plugin: ["oh-my-opencode@3.15.0"] }, null, 2) + "\n", "utf-8")

    // when
    const result = await addPluginToOpenCodeConfig("3.16.0")

    // then
    expect(result.success).toBe(true)
    const savedConfig = JSON.parse(readFileSync(testConfigPath, "utf-8"))
    expect(savedConfig.plugin).toEqual(["oh-my-openagent@3.16.0"])
    resolvePluginInstallReferenceSpy.mockRestore()
  })

  it("removes stale legacy entry when canonical and legacy entries both exist", async () => {
    // given
    const resolvePluginInstallReferenceSpy = mockInstallReference("3.11.0")
    writeFileSync(testConfigPath, JSON.stringify({ plugin: ["oh-my-openagent", "oh-my-opencode"] }, null, 2) + "\n", "utf-8")

    // when
    const result = await addPluginToOpenCodeConfig("3.11.0")

    // then
    expect(result.success).toBe(true)
    const savedConfig = JSON.parse(readFileSync(testConfigPath, "utf-8"))
    expect(savedConfig.plugin).toEqual(["oh-my-openagent@3.11.0"])
    resolvePluginInstallReferenceSpy.mockRestore()
  })

  it("preserves a canonical entry when the same version is re-installed", async () => {
    // given
    const resolvePluginInstallReferenceSpy = spyOn(pluginNameWithVersion, "resolvePluginInstallReference").mockResolvedValue({
      entry: "oh-my-openagent@3.10.0",
      channel: "latest",
    })
    writeFileSync(testConfigPath, JSON.stringify({ plugin: ["oh-my-openagent@3.10.0"] }, null, 2) + "\n", "utf-8")

    // when
    const result = await addPluginToOpenCodeConfig("3.10.0")

    // then
    expect(result.success).toBe(true)
    const savedConfig = JSON.parse(readFileSync(testConfigPath, "utf-8"))
    expect(savedConfig.plugin).toEqual(["oh-my-openagent@3.10.0"])
    resolvePluginInstallReferenceSpy.mockRestore()
  })

  it("blocks a downgrade for a version-pinned canonical entry", async () => {
    // given
    const resolvePluginInstallReferenceSpy = spyOn(pluginNameWithVersion, "resolvePluginInstallReference").mockResolvedValue({
      entry: "oh-my-openagent@3.15.0",
      channel: "latest",
    })
    writeFileSync(testConfigPath, JSON.stringify({ plugin: ["oh-my-openagent@3.16.0"] }, null, 2) + "\n", "utf-8")

    // when
    const result = await addPluginToOpenCodeConfig("3.15.0")

    // then
    expect(result.success).toBe(false)
    expect(result.error).toContain("Downgrade")

    const savedConfig = JSON.parse(readFileSync(testConfigPath, "utf-8"))
    expect(savedConfig.plugin).toEqual(["oh-my-openagent@3.16.0"])
    resolvePluginInstallReferenceSpy.mockRestore()
  })

  it("rewrites quoted jsonc plugin field in place", async () => {
    // given
    const resolvePluginInstallReferenceSpy = mockInstallReference("3.11.0")
    testConfigPath = join(testConfigDir, "opencode.jsonc")
    writeFileSync(testConfigPath, '{\n  "plugin": ["oh-my-opencode"]\n}\n', "utf-8")

    // when
    const result = await addPluginToOpenCodeConfig("3.11.0")

    // then
    expect(result.success).toBe(true)
    const savedContent = readFileSync(testConfigPath, "utf-8")
    expect(savedContent.includes('"plugin": [\n    "oh-my-openagent@3.11.0"\n  ]')).toBe(true)
    expect(savedContent.includes("oh-my-opencode")).toBe(false)
    resolvePluginInstallReferenceSpy.mockRestore()
  })
})
