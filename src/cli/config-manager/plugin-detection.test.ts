import { afterEach, beforeEach, describe, expect, it } from "bun:test"
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { pathToFileURL } from "node:url"

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

  it("detects both legacy and canonical plugin entries", () => {
    // given
    writeFileSync(testConfigPath, JSON.stringify({ plugin: ["oh-my-opencode", "oh-my-openagent@3.11.0"] }, null, 2) + "\n", "utf-8")

    // when
    const result = detectCurrentConfig()

    // then
    expect(result.isInstalled).toBe(true)
  })

  it("detects installer-managed file plugin entries", () => {
    // given
    const managedEntry = pathToFileURL(join(testConfigDir, "node_modules", "oh-my-opencode", "dist", "index.js")).toString()
    writeFileSync(testConfigPath, JSON.stringify({ plugin: [managedEntry] }, null, 2) + "\n", "utf-8")

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
    writeFileSync(testOmoConfigPath, JSON.stringify({ agents: { atlas: { model: "opencode-go/kimi-k2.5" } } }, null, 2) + "\n", "utf-8")

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
  let testPackageJsonPath = ""

  beforeEach(() => {
    testConfigDir = join(tmpdir(), `omo-add-plugin-${Date.now()}-${Math.random().toString(36).slice(2)}`)
    testConfigPath = join(testConfigDir, "opencode.json")
    testPackageJsonPath = join(testConfigDir, "package.json")

    mkdirSync(testConfigDir, { recursive: true })
    process.env.OPENCODE_CONFIG_DIR = testConfigDir
    resetConfigContext()
  })

  afterEach(() => {
    rmSync(testConfigDir, { recursive: true, force: true })
    resetConfigContext()
    delete process.env.OPENCODE_CONFIG_DIR
  })

  it("writes a managed file plugin entry for new installs", async () => {
    // given
    writeFileSync(testConfigPath, JSON.stringify({}, null, 2) + "\n", "utf-8")

    // when
    const result = await addPluginToOpenCodeConfig("3.11.0")

    // then
    expect(result.success).toBe(true)
    const savedConfig = JSON.parse(readFileSync(testConfigPath, "utf-8"))
    expect(savedConfig.plugin).toEqual([
      pathToFileURL(join(testConfigDir, "node_modules", "oh-my-opencode", "dist", "index.js")).toString(),
    ])

    const packageJson = JSON.parse(readFileSync(testPackageJsonPath, "utf-8"))
    expect(packageJson.dependencies).toEqual({ "oh-my-opencode": "latest" })
  })

  it("upgrades a bare legacy plugin entry to a managed file entry", async () => {
    // given
    writeFileSync(testConfigPath, JSON.stringify({ plugin: ["oh-my-opencode"] }, null, 2) + "\n", "utf-8")

    // when
    const result = await addPluginToOpenCodeConfig("3.11.0")

    // then
    expect(result.success).toBe(true)
    const savedConfig = JSON.parse(readFileSync(testConfigPath, "utf-8"))
    expect(savedConfig.plugin).toEqual([
      pathToFileURL(join(testConfigDir, "node_modules", "oh-my-opencode", "dist", "index.js")).toString(),
    ])

    const packageJson = JSON.parse(readFileSync(testPackageJsonPath, "utf-8"))
    expect(packageJson.dependencies).toEqual({ "oh-my-opencode": "latest" })
  })

  it("upgrades a version-pinned legacy entry to a managed file entry", async () => {
    // given
    writeFileSync(testConfigPath, JSON.stringify({ plugin: ["oh-my-opencode@3.10.0"] }, null, 2) + "\n", "utf-8")

    // when
    const result = await addPluginToOpenCodeConfig("3.11.0")

    // then
    expect(result.success).toBe(true)
    const savedConfig = JSON.parse(readFileSync(testConfigPath, "utf-8"))
    expect(savedConfig.plugin).toEqual([
      pathToFileURL(join(testConfigDir, "node_modules", "oh-my-opencode", "dist", "index.js")).toString(),
    ])

    const packageJson = JSON.parse(readFileSync(testPackageJsonPath, "utf-8"))
    expect(packageJson.dependencies).toEqual({ "oh-my-opencode": "3.10.0" })
  })

  it("removes stale legacy entry when canonical and legacy entries both exist", async () => {
    // given
    writeFileSync(testConfigPath, JSON.stringify({ plugin: ["oh-my-openagent", "oh-my-opencode"] }, null, 2) + "\n", "utf-8")

    // when
    const result = await addPluginToOpenCodeConfig("3.11.0")

    // then
    expect(result.success).toBe(true)
    const savedConfig = JSON.parse(readFileSync(testConfigPath, "utf-8"))
    expect(savedConfig.plugin).toEqual([
      pathToFileURL(join(testConfigDir, "node_modules", "oh-my-opencode", "dist", "index.js")).toString(),
    ])

    const packageJson = JSON.parse(readFileSync(testPackageJsonPath, "utf-8"))
    expect(packageJson.dependencies).toEqual({ "oh-my-opencode": "latest" })
  })

  it("preserves a canonical version pin when converting to a managed file entry", async () => {
    // given
    writeFileSync(testConfigPath, JSON.stringify({ plugin: ["oh-my-openagent@3.10.0"] }, null, 2) + "\n", "utf-8")

    // when
    const result = await addPluginToOpenCodeConfig("3.11.0")

    // then
    expect(result.success).toBe(true)
    const savedConfig = JSON.parse(readFileSync(testConfigPath, "utf-8"))
    expect(savedConfig.plugin).toEqual([
      pathToFileURL(join(testConfigDir, "node_modules", "oh-my-opencode", "dist", "index.js")).toString(),
    ])

    const packageJson = JSON.parse(readFileSync(testPackageJsonPath, "utf-8"))
    expect(packageJson.dependencies).toEqual({ "oh-my-opencode": "3.10.0" })
  })

  it("preserves an existing local-dev file entry", async () => {
    // given
    const localDevEntry = pathToFileURL("/tmp/oh-my-openagent/dist/index.js").toString()
    writeFileSync(testConfigPath, JSON.stringify({ plugin: [localDevEntry, "oh-my-openagent"] }, null, 2) + "\n", "utf-8")

    // when
    const result = await addPluginToOpenCodeConfig("3.11.0")

    // then
    expect(result.success).toBe(true)
    const savedConfig = JSON.parse(readFileSync(testConfigPath, "utf-8"))
    expect(savedConfig.plugin).toEqual([localDevEntry])
  })

  it("rewrites quoted jsonc plugin field in place", async () => {
    // given
    testConfigPath = join(testConfigDir, "opencode.jsonc")
    writeFileSync(testConfigPath, '{\n  "plugin": ["oh-my-opencode"]\n}\n', "utf-8")

    // when
    const result = await addPluginToOpenCodeConfig("3.11.0")

    // then
    expect(result.success).toBe(true)
    const savedContent = readFileSync(testConfigPath, "utf-8")
    expect(savedContent.includes(`"plugin": [\n    "${pathToFileURL(join(testConfigDir, "node_modules", "oh-my-opencode", "dist", "index.js")).toString()}"\n  ]`)).toBe(true)
    expect(savedContent.includes('"plugin": ["oh-my-opencode"]')).toBe(false)

    const packageJson = JSON.parse(readFileSync(testPackageJsonPath, "utf-8"))
    expect(packageJson.dependencies).toEqual({ "oh-my-opencode": "latest" })
  })
})
