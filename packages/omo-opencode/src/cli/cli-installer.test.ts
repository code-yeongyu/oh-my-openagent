import { afterEach, beforeEach, describe, expect, it, mock, spyOn } from "bun:test"
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import * as configManager from "./config-manager"
import * as codexInstaller from "./install-codex"
import { runCliInstaller } from "./cli-installer"
import { ULTIMATE_FALLBACK } from "./model-fallback"
import { getNoModelProvidersWarning } from "./provider-availability"
import { PLUGIN_NAME } from "../shared"
import type { InstallArgs } from "./types"

describe("runCliInstaller", () => {
  const mockConsoleLog = mock(() => {})
  const mockConsoleError = mock(() => {})
  const originalConsoleLog = console.log
  const originalConsoleError = console.error

  beforeEach(() => {
    console.log = mockConsoleLog
    console.error = mockConsoleError
    mockConsoleLog.mockClear()
    mockConsoleError.mockClear()
  })

  afterEach(() => {
    console.log = originalConsoleLog
    console.error = originalConsoleError
    mock.restore()
  })

  it("blocks installation when OpenCode is below the minimum version", async () => {
    // given
    const restoreSpies = [
      spyOn(configManager, "detectCurrentConfig").mockReturnValue({
        isInstalled: false,
        installedVersion: null,
        hasClaude: false,
        isMax20: false,
        hasOpenAI: false,
        hasGemini: false,
        hasCopilot: false,
        hasCodex: false,
        hasOpencodeZen: false,
        hasZaiCodingPlan: false,
        hasKimiForCoding: false,
        hasOpencodeGo: false,
      hasBailianCodingPlan: false,
        hasVercelAiGateway: false,
      }),
      spyOn(configManager, "isOpenCodeInstalled").mockResolvedValue(true),
      spyOn(configManager, "getOpenCodeVersion").mockResolvedValue("1.3.9"),
    ]
    const addPluginSpy = spyOn(configManager, "addPluginToOpenCodeConfig")

    const args: InstallArgs = {
      tui: false,
      platform: "opencode",
      claude: "no",
      openai: "no",
      gemini: "no",
      copilot: "no",
      opencodeZen: "no",
      zaiCodingPlan: "no",
      kimiForCoding: "no",
      opencodeGo: "no",
    }

    // when
    const result = await runCliInstaller(args, "3.16.0")

    // then
    expect(result).toBe(1)
    expect(addPluginSpy).not.toHaveBeenCalled()

    for (const spy of restoreSpies) {
      spy.mockRestore()
    }
    addPluginSpy.mockRestore()
  })

  it("completes installation without auth plugin or provider config steps", async () => {
    // given
    const restoreSpies = [
      spyOn(configManager, "detectCurrentConfig").mockReturnValue({
        isInstalled: false,
        installedVersion: null,
        hasClaude: false,
        isMax20: false,
        hasOpenAI: false,
        hasGemini: false,
        hasCopilot: false,
        hasCodex: false,
        hasOpencodeZen: false,
        hasZaiCodingPlan: false,
        hasKimiForCoding: false,
        hasOpencodeGo: false,
      hasBailianCodingPlan: false,
        hasVercelAiGateway: false,
      }),
      spyOn(configManager, "isOpenCodeInstalled").mockResolvedValue(true),
      spyOn(configManager, "getOpenCodeVersion").mockResolvedValue("1.4.0"),
      spyOn(configManager, "addPluginToOpenCodeConfig").mockResolvedValue({
        success: true,
        configPath: "/tmp/opencode.jsonc",
      }),
      spyOn(configManager, "writeOmoConfig").mockReturnValue({
        success: true,
        configPath: "/tmp/oh-my-opencode.jsonc",
      }),
    ]

    const args: InstallArgs = {
      tui: false,
      platform: "opencode",
      claude: "no",
      openai: "yes",
      gemini: "no",
      copilot: "yes",
      opencodeZen: "no",
      zaiCodingPlan: "no",
      kimiForCoding: "no",
      opencodeGo: "no",
    }

    // when
    const result = await runCliInstaller(args, "3.4.0")

    // then
    expect(result).toBe(0)

    for (const spy of restoreSpies) {
      spy.mockRestore()
    }
  })

  it("registers the TUI plugin entry after adding the OpenCode server plugin", async () => {
    const originalConfigDir = process.env.OPENCODE_CONFIG_DIR
    const configDir = mkdtempSync(join(tmpdir(), "omo-cli-tui-entry-"))
    process.env.OPENCODE_CONFIG_DIR = configDir

    try {
      const restoreSpies = [
        spyOn(configManager, "detectCurrentConfig").mockReturnValue({
          isInstalled: false,
          installedVersion: null,
          hasClaude: false,
          isMax20: false,
          hasOpenAI: false,
          hasGemini: false,
          hasCopilot: false,
          hasCodex: false,
          hasOpencodeZen: false,
          hasZaiCodingPlan: false,
          hasKimiForCoding: false,
          hasOpencodeGo: false,
          hasBailianCodingPlan: false,
          hasMinimaxCnCodingPlan: false,
          hasMinimaxCodingPlan: false,
          hasVercelAiGateway: false,
        }),
        spyOn(configManager, "isOpenCodeInstalled").mockResolvedValue(true),
        spyOn(configManager, "getOpenCodeVersion").mockResolvedValue("1.4.0"),
        spyOn(configManager, "addPluginToOpenCodeConfig").mockImplementation(async () => {
          writeFileSync(join(configDir, "opencode.json"), JSON.stringify({ plugin: [PLUGIN_NAME] }), "utf-8")
          return { success: true, configPath: join(configDir, "opencode.json") }
        }),
        spyOn(configManager, "writeOmoConfig").mockReturnValue({
          success: true,
          configPath: join(configDir, "oh-my-openagent.jsonc"),
        }),
      ]

      const args: InstallArgs = {
        tui: false,
        platform: "opencode",
        claude: "no",
        openai: "yes",
        gemini: "no",
        copilot: "no",
        opencodeZen: "no",
        zaiCodingPlan: "no",
        kimiForCoding: "no",
        opencodeGo: "no",
      }

      const result = await runCliInstaller(args, "3.4.0")

      expect(result).toBe(0)
      expect(readFileSync(join(configDir, "tui.json"), "utf-8")).toContain(`"${PLUGIN_NAME}"`)

      for (const spy of restoreSpies) {
        spy.mockRestore()
      }
    } finally {
      rmSync(configDir, { recursive: true, force: true })
      if (originalConfigDir === undefined) {
        delete process.env.OPENCODE_CONFIG_DIR
      } else {
        process.env.OPENCODE_CONFIG_DIR = originalConfigDir
      }
    }
  })

  it("skips OpenCode checks and writes for platform=codex", async () => {
    // given
    const detectSpy = spyOn(configManager, "detectCurrentConfig")
    const installedSpy = spyOn(configManager, "isOpenCodeInstalled")
    const versionSpy = spyOn(configManager, "getOpenCodeVersion")
    const addPluginSpy = spyOn(configManager, "addPluginToOpenCodeConfig")
    const writeConfigSpy = spyOn(configManager, "writeOmoConfig")

    const codexSpy = spyOn(codexInstaller, "runCodexInstaller").mockResolvedValue({
      installed: [],
      configPath: "/tmp/codex-config.toml",
      codexHome: "/tmp/codex-home",
      marketplaceName: "sisyphuslabs",
      gitBashPath: null,
      projectCleanup: {
        projectRoot: null,
        configPath: null,
        changed: false,
        removedKeys: [],
        configs: [],
        artifacts: [],
      },
    })

    const args: InstallArgs = {
      tui: false,
      platform: "codex",
    }

    // when
    const result = await runCliInstaller(args, "3.4.0")

    // then
    expect(result).toBe(0)
    expect(detectSpy).not.toHaveBeenCalled()
    expect(installedSpy).not.toHaveBeenCalled()
    expect(versionSpy).not.toHaveBeenCalled()
    expect(addPluginSpy).not.toHaveBeenCalled()
    expect(writeConfigSpy).not.toHaveBeenCalled()
    const output = mockConsoleLog.mock.calls.map((call) => call.join(" ")).join("\n")
    expect(output).not.toContain("Model Assignment")
    expect(output).not.toContain("OpenAI/ChatGPT")
    expect(output).not.toContain("Sisyphus agent performs best")

    detectSpy.mockRestore()
    installedSpy.mockRestore()
    versionSpy.mockRestore()
    addPluginSpy.mockRestore()
    writeConfigSpy.mockRestore()
    codexSpy.mockRestore()
  })

  it("does not warn about missing providers when only Bailian is configured", async () => {
    const restoreSpies = [
      spyOn(configManager, "detectCurrentConfig").mockReturnValue({
        isInstalled: false,
        installedVersion: null,
        hasClaude: false,
        isMax20: false,
        hasOpenAI: false,
        hasGemini: false,
        hasCopilot: false,
        hasCodex: false,
        hasOpencodeZen: false,
        hasZaiCodingPlan: false,
        hasKimiForCoding: false,
        hasOpencodeGo: false,
        hasBailianCodingPlan: false,
        hasMinimaxCnCodingPlan: false,
        hasMinimaxCodingPlan: false,
        hasVercelAiGateway: false,
      }),
      spyOn(configManager, "isOpenCodeInstalled").mockResolvedValue(true),
      spyOn(configManager, "getOpenCodeVersion").mockResolvedValue("1.4.0"),
      spyOn(configManager, "addPluginToOpenCodeConfig").mockResolvedValue({
        success: true,
        configPath: "/tmp/opencode.jsonc",
      }),
      spyOn(configManager, "writeOmoConfig").mockReturnValue({
        success: true,
        configPath: "/tmp/oh-my-opencode.jsonc",
      }),
    ]

    const args: InstallArgs = {
      tui: false,
      platform: "opencode",
      claude: "no",
      openai: "no",
      gemini: "no",
      copilot: "no",
      opencodeZen: "no",
      zaiCodingPlan: "no",
      kimiForCoding: "no",
      opencodeGo: "no",
      bailianCodingPlan: "yes",
      minimaxCnCodingPlan: "no",
      minimaxCodingPlan: "no",
      vercelAiGateway: "no",
    }

    const result = await runCliInstaller(args, "3.4.0")

    expect(result).toBe(0)
    const output = mockConsoleLog.mock.calls.map((call) => call.join(" ")).join("\n")
    expect(output).not.toContain("No model providers configured")

    for (const spy of restoreSpies) {
      spy.mockRestore()
    }
  })

  it("warns with ultimate fallback when no providers are configured", async () => {
    const restoreSpies = [
      spyOn(configManager, "detectCurrentConfig").mockReturnValue({
        isInstalled: false,
        installedVersion: null,
        hasClaude: false,
        isMax20: false,
        hasOpenAI: false,
        hasGemini: false,
        hasCopilot: false,
        hasCodex: false,
        hasOpencodeZen: false,
        hasZaiCodingPlan: false,
        hasKimiForCoding: false,
        hasOpencodeGo: false,
        hasBailianCodingPlan: false,
        hasMinimaxCnCodingPlan: false,
        hasMinimaxCodingPlan: false,
        hasVercelAiGateway: false,
      }),
      spyOn(configManager, "isOpenCodeInstalled").mockResolvedValue(true),
      spyOn(configManager, "getOpenCodeVersion").mockResolvedValue("1.4.0"),
      spyOn(configManager, "addPluginToOpenCodeConfig").mockResolvedValue({
        success: true,
        configPath: "/tmp/opencode.jsonc",
      }),
      spyOn(configManager, "writeOmoConfig").mockReturnValue({
        success: true,
        configPath: "/tmp/oh-my-opencode.jsonc",
      }),
    ]

    const args: InstallArgs = {
      tui: false,
      platform: "opencode",
      claude: "no",
      openai: "no",
      gemini: "no",
      copilot: "no",
      opencodeZen: "no",
      zaiCodingPlan: "no",
      kimiForCoding: "no",
      opencodeGo: "no",
      bailianCodingPlan: "no",
      minimaxCnCodingPlan: "no",
      minimaxCodingPlan: "no",
      vercelAiGateway: "no",
    }

    const result = await runCliInstaller(args, "3.4.0")

    expect(result).toBe(0)
    const output = mockConsoleLog.mock.calls.map((call) => call.join(" ")).join("\n")
    expect(output).toContain(getNoModelProvidersWarning())
    expect(output).toContain(ULTIMATE_FALLBACK)
    expect(output).not.toContain("opencode/big-pickle")

    for (const spy of restoreSpies) {
      spy.mockRestore()
    }
  })
})
