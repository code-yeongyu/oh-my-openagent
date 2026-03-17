import { afterEach, beforeEach, describe, expect, it } from "bun:test"
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { resetConfigContext } from "./config-context"
import { detectCurrentConfig } from "./detect-current-config"
import { addPluginToOpenCodeConfig } from "./add-plugin-to-opencode-config"

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

  it("detects oh-my-opencode in plugin array", () => {
    // given
    const config = { plugin: ["oh-my-opencode"] }
    writeFileSync(testConfigPath, JSON.stringify(config, null, 2) + "\n", "utf-8")

    // when
    const result = detectCurrentConfig()

    // then
    expect(result.isInstalled).toBe(true)
  })

  it("detects oh-my-opencode with version pin", () => {
    // given
    const config = { plugin: ["oh-my-opencode@3.11.0"] }
    writeFileSync(testConfigPath, JSON.stringify(config, null, 2) + "\n", "utf-8")

    // when
    const result = detectCurrentConfig()

    // then
    expect(result.isInstalled).toBe(true)
  })

  it("detects oh-my-openagent as installed (legacy name)", () => {
    // given
    const config = { plugin: ["oh-my-openagent"] }
    writeFileSync(testConfigPath, JSON.stringify(config, null, 2) + "\n", "utf-8")

    // when
    const result = detectCurrentConfig()

    // then
    expect(result.isInstalled).toBe(true)
  })

  it("detects oh-my-openagent with version pin as installed (legacy name)", () => {
    // given
    const config = { plugin: ["oh-my-openagent@3.11.0"] }
    writeFileSync(testConfigPath, JSON.stringify(config, null, 2) + "\n", "utf-8")

    // when
    const result = detectCurrentConfig()

    // then
    expect(result.isInstalled).toBe(true)
  })

  it("returns false when plugin not present", () => {
    // given
    const config = { plugin: ["some-other-plugin"] }
    writeFileSync(testConfigPath, JSON.stringify(config, null, 2) + "\n", "utf-8")

    // when
    const result = detectCurrentConfig()

    // then
    expect(result.isInstalled).toBe(false)
  })

  it("returns false when plugin not present (even with similar name)", () => {
    // given - not exactly oh-my-openagent
    const config = { plugin: ["oh-my-openagent-extra"] }
    writeFileSync(testConfigPath, JSON.stringify(config, null, 2) + "\n", "utf-8")

    // when
    const result = detectCurrentConfig()

    // then
    expect(result.isInstalled).toBe(false)
  })

  it("detects OpenCode Go from the existing omo config", () => {
    // given
    writeFileSync(testConfigPath, JSON.stringify({ plugin: ["oh-my-opencode"] }, null, 2) + "\n", "utf-8")
    writeFileSync(
      testOmoConfigPath,
      JSON.stringify({ agents: { atlas: { model: "opencode-go/kimi-k2.5" } } }, null, 2) + "\n",
      "utf-8",
    )

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

  it("keeps oh-my-opencode when it already exists", async () => {
    // given
    const config = { plugin: ["oh-my-opencode"] }
    writeFileSync(testConfigPath, JSON.stringify(config, null, 2) + "\n", "utf-8")

    // when
    const result = await addPluginToOpenCodeConfig("3.11.0")

    // then
    expect(result.success).toBe(true)
    const savedConfig = JSON.parse(readFileSync(testConfigPath, "utf-8"))
    expect(savedConfig.plugin).toContain("oh-my-opencode")
  })

  it("replaces version-pinned oh-my-opencode@X.Y.Z", async () => {
    // given
    const config = { plugin: ["oh-my-opencode@3.10.0"] }
    writeFileSync(testConfigPath, JSON.stringify(config, null, 2) + "\n", "utf-8")

    // when
    const result = await addPluginToOpenCodeConfig("3.11.0")

    // then
    expect(result.success).toBe(true)
    const savedConfig = JSON.parse(readFileSync(testConfigPath, "utf-8"))
    expect(savedConfig.plugin).toContain("oh-my-opencode")
    expect(savedConfig.plugin).not.toContain("oh-my-opencode@3.10.0")
  })

  it("recognizes oh-my-openagent as already installed (legacy name)", async () => {
    // given
    const config = { plugin: ["oh-my-openagent"] }
    writeFileSync(testConfigPath, JSON.stringify(config, null, 2) + "\n", "utf-8")

    // when
    const result = await addPluginToOpenCodeConfig("3.11.0")

    // then
    expect(result.success).toBe(true)
    const savedConfig = JSON.parse(readFileSync(testConfigPath, "utf-8"))
    // Should upgrade to new name
    expect(savedConfig.plugin).toContain("oh-my-opencode")
    expect(savedConfig.plugin).not.toContain("oh-my-openagent")
  })

  it("replaces version-pinned oh-my-openagent@X.Y.Z with new name", async () => {
    // given
    const config = { plugin: ["oh-my-openagent@3.10.0"] }
    writeFileSync(testConfigPath, JSON.stringify(config, null, 2) + "\n", "utf-8")

    // when
    const result = await addPluginToOpenCodeConfig("3.11.0")

    // then
    expect(result.success).toBe(true)
    const savedConfig = JSON.parse(readFileSync(testConfigPath, "utf-8"))
    // Legacy should be replaced with new name
    expect(savedConfig.plugin).toContain("oh-my-opencode")
    expect(savedConfig.plugin).not.toContain("oh-my-openagent")
  })

  it("adds new plugin when none exists", async () => {
    // given
    const config = {}
    writeFileSync(testConfigPath, JSON.stringify(config, null, 2) + "\n", "utf-8")

    // when
    const result = await addPluginToOpenCodeConfig("3.11.0")

    // then
    expect(result.success).toBe(true)
    const savedConfig = JSON.parse(readFileSync(testConfigPath, "utf-8"))
    expect(savedConfig.plugin).toContain("oh-my-opencode")
  })

  it("adds plugin when plugin array is empty", async () => {
    // given
    const config = { plugin: [] }
    writeFileSync(testConfigPath, JSON.stringify(config, null, 2) + "\n", "utf-8")

    // when
    const result = await addPluginToOpenCodeConfig("3.11.0")

    // then
    expect(result.success).toBe(true)
    const savedConfig = JSON.parse(readFileSync(testConfigPath, "utf-8"))
    expect(savedConfig.plugin).toContain("oh-my-opencode")
  })
})
