import { afterEach, beforeEach, describe, expect, it, spyOn } from "bun:test"
import * as fs from "node:fs"
import { mkdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { resetConfigContext } from "./config-context"
import { detectCurrentConfig } from "./detect-current-config"
import { addPluginToOpenCodeConfig } from "./add-plugin-to-opencode-config"
import * as pluginNameWithVersion from "./plugin-name-with-version"
import { _resetProviderAuthCacheForTesting } from "../../shared"
import { detectedToInitialValues } from "../install-validators"
import type { DetectedConfig } from "../types"

const sourcePlugin = new URL("../../index.ts", import.meta.url).href

describe("detectCurrentConfig - single package detection", () => {
  let testConfigDir = ""
  let homeDirectory = ""
  let originalHome: string | undefined
  let testConfigPath = ""
  let testOmoConfigPath = ""

  beforeEach(() => {
    testConfigDir = join(tmpdir(), `omo-detect-config-${Date.now()}-${Math.random().toString(36).slice(2)}`)
    homeDirectory = join(testConfigDir, "home")
    testConfigPath = join(testConfigDir, "opencode.json")
    testOmoConfigPath = join(homeDirectory, ".omo", "omo.jsonc")

    mkdirSync(join(testOmoConfigPath, ".."), { recursive: true })
    originalHome = process.env.HOME
    process.env.HOME = homeDirectory
    process.env.OPENCODE_CONFIG_DIR = testConfigDir
    resetConfigContext()
  })

  afterEach(() => {
    rmSync(testConfigDir, { recursive: true, force: true })
    resetConfigContext()
    delete process.env.OPENCODE_CONFIG_DIR
    if (originalHome === undefined) delete process.env.HOME
    else process.env.HOME = originalHome
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
    writeFileSync(testOmoConfigPath, JSON.stringify({
      "[opencode]": { agents: { atlas: { model: "opencode-go/kimi-k2.6" } } },
    }, null, 2) + "\n", "utf-8")

    // when
    const result = detectCurrentConfig()

    // then
    expect(result.isInstalled).toBe(true)
    expect(result.hasOpencodeGo).toBe(true)
  })

  it("uses default provider detection when omo config reading throws a non-Error value", () => {
    // given
    writeFileSync(testConfigPath, JSON.stringify({ plugin: ["oh-my-opencode"] }, null, 2) + "\n", "utf-8")
    writeFileSync(testOmoConfigPath, "{}\n", "utf-8")
    const originalReadFileSync = fs.readFileSync
    const readFileSyncSpy = spyOn(fs, "readFileSync").mockImplementation((filePath, options) => {
      if (String(filePath).replaceAll("\\", "/").endsWith(".omo/omo.jsonc")) {
        throw "read failed"
      }
      return originalReadFileSync(filePath, options)
    })

    try {
      // when
      const result = detectCurrentConfig()

      // then
      expect(result.isInstalled).toBe(true)
      expect(result.hasOpenAI).toBe(true)
      expect(result.hasOpencodeZen).toBe(true)
      expect(result.hasOpencodeGo).toBe(false)
    } finally {
      readFileSyncSpy.mockRestore()
    }
  })
})

describe("detectCurrentConfig - provider recognition", () => {
  let testConfigDir = ""
  let homeDirectory = ""
  let originalHome: string | undefined
  let testConfigPath = ""
  let testOmoConfigPath = ""

  beforeEach(() => {
    testConfigDir = join(tmpdir(), `omo-detect-providers-${Date.now()}-${Math.random().toString(36).slice(2)}`)
    homeDirectory = join(testConfigDir, "home")
    testConfigPath = join(testConfigDir, "opencode.json")
    testOmoConfigPath = join(homeDirectory, ".omo", "omo.jsonc")

    mkdirSync(join(testOmoConfigPath, ".."), { recursive: true })
    originalHome = process.env.HOME
    process.env.HOME = homeDirectory
    process.env.OPENCODE_CONFIG_DIR = testConfigDir
    resetConfigContext()
  })

  afterEach(() => {
    rmSync(testConfigDir, { recursive: true, force: true })
    resetConfigContext()
    delete process.env.OPENCODE_CONFIG_DIR
    if (originalHome === undefined) delete process.env.HOME
    else process.env.HOME = originalHome
    _resetProviderAuthCacheForTesting()
  })

  it("reports Claude=no Gemini=yes for an install using only Gemini, OpenCode Go, and OpenCode Zen", () => {
    // given an existing install whose only native provider is Google (issue #6381 scenario)
    writeFileSync(testConfigPath, JSON.stringify({
      plugin: ["oh-my-openagent"],
      provider: { google: { options: { apiKey: "[REDACTED]" } } },
    }, null, 2) + "\n", "utf-8")
    writeFileSync(testOmoConfigPath, JSON.stringify({
      "[opencode]": {
        agents: {
          atlas: { model: "opencode-go/kimi-k2.6" },
          hephaestus: { model: "opencode/gpt-5.6-sol" },
        },
      },
    }, null, 2) + "\n", "utf-8")

    // when
    const result = detectCurrentConfig()

    // then the existing configuration is recognized, not assumed to be Claude max20
    expect(result.isInstalled).toBe(true)
    expect(result.hasClaude).toBe(false)
    expect(result.isMax20).toBe(false)
    expect(result.hasGemini).toBe(true)
    expect(result.hasOpencodeGo).toBe(true)
    expect(result.hasOpencodeZen).toBe(true)
  })

  it("detects an Anthropic provider entry as Claude present without claiming max20", () => {
    // given an existing install with both anthropic and google provider blocks
    writeFileSync(testConfigPath, JSON.stringify({
      plugin: ["oh-my-openagent"],
      provider: {
        anthropic: { options: { apiKey: "[REDACTED]" } },
        google: { options: { apiKey: "[REDACTED]" } },
      },
    }, null, 2) + "\n", "utf-8")

    // when
    const result = detectCurrentConfig()

    // then Claude is detected from the provider block; the max20 tier is not recorded on disk
    expect(result.isInstalled).toBe(true)
    expect(result.hasClaude).toBe(true)
    expect(result.isMax20).toBe(false)
    expect(result.hasGemini).toBe(true)
  })

  it("detects a Claude OAuth login from auth.json even without a provider block", () => {
    // given an existing install with no provider blocks but an anthropic auth.json entry
    writeFileSync(testConfigPath, JSON.stringify({ plugin: ["oh-my-openagent"] }, null, 2) + "\n", "utf-8")
    const originalXdgDataHome = process.env.XDG_DATA_HOME
    const tempDataDir = join(testConfigDir, "xdg-data")
    process.env.XDG_DATA_HOME = tempDataDir
    mkdirSync(join(tempDataDir, "opencode"), { recursive: true })
    writeFileSync(join(tempDataDir, "opencode", "auth.json"), JSON.stringify({
      anthropic: { type: "oauth" },
    }, null, 2) + "\n", "utf-8")
    _resetProviderAuthCacheForTesting()

    try {
      // when
      const result = detectCurrentConfig()

      // then the OAuth credential proves Claude is configured
      expect(result.isInstalled).toBe(true)
      expect(result.hasClaude).toBe(true)
    } finally {
      _resetProviderAuthCacheForTesting()
      if (originalXdgDataHome === undefined) delete process.env.XDG_DATA_HOME
      else process.env.XDG_DATA_HOME = originalXdgDataHome
      _resetProviderAuthCacheForTesting()
    }
  })

  it("reports nothing detected when no OpenCode config exists", () => {
    // given no opencode config file at all

    // when
    const result = detectCurrentConfig()

    // then no provider presence may be claimed
    expect(result.isInstalled).toBe(false)
    expect(result.hasClaude).toBe(false)
    expect(result.isMax20).toBe(false)
    expect(result.hasGemini).toBe(false)
  })

  it("maps the issue scenario to claude=no gemini=yes initial prompt values", () => {
    // given a DetectedConfig matching the issue #6381 report
    const detected: DetectedConfig = {
      isInstalled: true,
      installedVersion: "4.19.2",
      hasClaude: false,
      isMax20: false,
      hasOpenAI: false,
      hasGemini: true,
      hasCopilot: false,
      hasCodex: false,
      hasOpencodeZen: true,
      hasZaiCodingPlan: false,
      hasKimiForCoding: false,
      hasOpencodeGo: true,
      hasBailianCodingPlan: false,
      hasMinimaxCnCodingPlan: false,
      hasMinimaxCodingPlan: false,
      hasVercelAiGateway: false,
    }

    // when
    const initial = detectedToInitialValues(detected)

    // then the update flow preserves the existing configuration
    expect(initial.claude).toBe("no")
    expect(initial.gemini).toBe("yes")
    expect(initial.opencodeGo).toBe("yes")
    expect(initial.opencodeZen).toBe("yes")
  })
})

describe("addPluginToOpenCodeConfig - single package writes", () => {
  let testConfigDir = ""
  let testConfigPath = ""
  let getPluginNameWithVersionSpy: ReturnType<typeof spyOn>

  beforeEach(() => {
    testConfigDir = join(tmpdir(), `omo-add-plugin-${Date.now()}-${Math.random().toString(36).slice(2)}`)
    testConfigPath = join(testConfigDir, "opencode.json")

    mkdirSync(testConfigDir, { recursive: true })
    process.env.OPENCODE_CONFIG_DIR = testConfigDir
    resetConfigContext()
    // Mock npm dist-tags lookup so tests don't make real network calls that
    // timeout under CI load. Individual tests override this with version-pinned
    // expectations when they need to assert on the version-tagged entry.
    getPluginNameWithVersionSpy = spyOn(pluginNameWithVersion, "getPluginNameWithVersion").mockResolvedValue("oh-my-openagent")
  })

  afterEach(() => {
    getPluginNameWithVersionSpy.mockRestore()
    rmSync(testConfigDir, { recursive: true, force: true })
    resetConfigContext()
    delete process.env.OPENCODE_CONFIG_DIR
  })

  it("writes canonical plugin entry for new installs", async () => {
    // given
    writeFileSync(testConfigPath, JSON.stringify({}, null, 2) + "\n", "utf-8")

    // when
    const result = await addPluginToOpenCodeConfig("3.11.0")

    // then
    expect(result.success).toBe(true)
    const savedConfig = JSON.parse(readFileSync(testConfigPath, "utf-8"))
    expect(savedConfig.plugin).toEqual(["oh-my-openagent"])
  })

  it("upgrades a bare legacy plugin entry to canonical", async () => {
    // given
    writeFileSync(testConfigPath, JSON.stringify({ plugin: ["oh-my-opencode"] }, null, 2) + "\n", "utf-8")

    // when
    const result = await addPluginToOpenCodeConfig("3.11.0")

    // then
    expect(result.success).toBe(true)
    const savedConfig = JSON.parse(readFileSync(testConfigPath, "utf-8"))
    expect(savedConfig.plugin).toEqual(["oh-my-openagent"])
  })

  it("updates a version-pinned legacy entry to the requested version", async () => {
    // given
    const getPluginNameWithVersionSpy = spyOn(pluginNameWithVersion, "getPluginNameWithVersion").mockResolvedValue("oh-my-openagent@3.16.0")
    writeFileSync(testConfigPath, JSON.stringify({ plugin: ["oh-my-opencode@3.15.0"] }, null, 2) + "\n", "utf-8")

    // when
    const result = await addPluginToOpenCodeConfig("3.16.0")

    // then
    expect(result.success).toBe(true)
    const savedConfig = JSON.parse(readFileSync(testConfigPath, "utf-8"))
    expect(savedConfig.plugin).toEqual(["oh-my-openagent@3.16.0"])
    getPluginNameWithVersionSpy.mockRestore()
  })

  it("removes stale legacy entry when canonical and legacy entries both exist", async () => {
    // given
    writeFileSync(testConfigPath, JSON.stringify({ plugin: ["oh-my-openagent", "oh-my-opencode"] }, null, 2) + "\n", "utf-8")

    // when
    const result = await addPluginToOpenCodeConfig("3.11.0")

    // then
    expect(result.success).toBe(true)
    const savedConfig = JSON.parse(readFileSync(testConfigPath, "utf-8"))
    expect(savedConfig.plugin).toEqual(["oh-my-openagent"])
  })

  it("preserves a canonical entry when the same version is re-installed", async () => {
    // given
    const getPluginNameWithVersionSpy = spyOn(pluginNameWithVersion, "getPluginNameWithVersion").mockResolvedValue("oh-my-openagent@3.10.0")
    writeFileSync(testConfigPath, JSON.stringify({ plugin: ["oh-my-openagent@3.10.0"] }, null, 2) + "\n", "utf-8")

    // when
    const result = await addPluginToOpenCodeConfig("3.10.0")

    // then
    expect(result.success).toBe(true)
    const savedConfig = JSON.parse(readFileSync(testConfigPath, "utf-8"))
    expect(savedConfig.plugin).toEqual(["oh-my-openagent@3.10.0"])
    getPluginNameWithVersionSpy.mockRestore()
  })

  it("blocks a downgrade for a version-pinned canonical entry", async () => {
    // given
    const getPluginNameWithVersionSpy = spyOn(pluginNameWithVersion, "getPluginNameWithVersion").mockResolvedValue("oh-my-openagent@3.15.0")
    writeFileSync(testConfigPath, JSON.stringify({ plugin: ["oh-my-openagent@3.16.0"] }, null, 2) + "\n", "utf-8")

    // when
    const result = await addPluginToOpenCodeConfig("3.15.0")

    // then
    expect(result.success).toBe(false)
    expect(result.error).toContain("Downgrade")

    const savedConfig = JSON.parse(readFileSync(testConfigPath, "utf-8"))
    expect(savedConfig.plugin).toEqual(["oh-my-openagent@3.16.0"])
    getPluginNameWithVersionSpy.mockRestore()
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
    expect(savedContent.includes('"plugin": [\n    "oh-my-openagent"\n  ]')).toBe(true)
    expect(savedContent.includes("oh-my-opencode")).toBe(false)
  })

  it("mirrors an existing source plugin entry into profile configs", async () => {
    // given
    writeFileSync(testConfigPath, JSON.stringify({ plugin: [sourcePlugin] }, null, 2) + "\n", "utf-8")

    const profileDir = join(testConfigDir, "profiles", "today")
    const profileConfigPath = join(profileDir, "opencode.json")
    mkdirSync(profileDir, { recursive: true })
    writeFileSync(
      profileConfigPath,
      JSON.stringify({ $schema: "https://opencode.ai/config.json" }, null, 2) + "\n",
      "utf-8",
    )

    // when
    const result = await addPluginToOpenCodeConfig("3.11.0")

    // then
    expect(result.success).toBe(true)
    const savedRootConfig = JSON.parse(readFileSync(testConfigPath, "utf-8"))
    const savedProfileConfig = JSON.parse(readFileSync(profileConfigPath, "utf-8"))
    expect(savedRootConfig.plugin).toEqual([sourcePlugin])
    expect(savedProfileConfig.plugin).toEqual([sourcePlugin])
  })

  it("uses the parent source plugin entry when OPENCODE_CONFIG_DIR points at a profile", async () => {
    // given
    writeFileSync(testConfigPath, JSON.stringify({ plugin: [sourcePlugin] }, null, 2) + "\n", "utf-8")

    const profileDir = join(testConfigDir, "profiles", "today")
    const profileConfigPath = join(profileDir, "opencode.json")
    mkdirSync(profileDir, { recursive: true })
    writeFileSync(
      profileConfigPath,
      JSON.stringify({ $schema: "https://opencode.ai/config.json" }, null, 2) + "\n",
      "utf-8",
    )

    process.env.OPENCODE_CONFIG_DIR = profileDir
    resetConfigContext()

    // when
    const result = await addPluginToOpenCodeConfig("3.11.0")

    // then
    expect(result.success).toBe(true)
    expect(result.configPath).toBe(join(realpathSync(profileDir), "opencode.json"))
    const savedProfileConfig = JSON.parse(readFileSync(profileConfigPath, "utf-8"))
    expect(savedProfileConfig.plugin).toEqual([sourcePlugin])
  })
})
