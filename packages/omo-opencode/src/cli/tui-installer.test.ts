import { afterEach, beforeEach, describe, expect, it, spyOn } from "bun:test"
import * as p from "@clack/prompts"
import * as configManager from "./config-manager"
import * as starRequest from "./star-request"
import * as tuiInstallPrompts from "./tui-install-prompts"
import { ULTIMATE_FALLBACK } from "./model-fallback"
import { getNoModelProvidersWarning } from "./provider-availability"
import { runTuiInstaller } from "./tui-installer"
import type { InstallConfig } from "./types"

function createMockSpinner(): ReturnType<typeof p.spinner> {
  return {
    start: () => undefined,
    stop: () => undefined,
    message: () => undefined,
    cancel: () => undefined,
    error: () => undefined,
    clear: () => undefined,
    isCancelled: false,
  }
}

describe("runTuiInstaller", () => {
  const originalIsStdinTty = process.stdin.isTTY
  const originalIsStdoutTty = process.stdout.isTTY

  beforeEach(() => {
    Object.defineProperty(process.stdin, "isTTY", { configurable: true, value: true })
    Object.defineProperty(process.stdout, "isTTY", { configurable: true, value: true })
  })

  afterEach(() => {
    Object.defineProperty(process.stdin, "isTTY", { configurable: true, value: originalIsStdinTty })
    Object.defineProperty(process.stdout, "isTTY", { configurable: true, value: originalIsStdoutTty })
  })

  it("blocks installation when OpenCode is below the minimum version", async () => {
    // given
    const restoreSpies = [
      spyOn(p, "spinner").mockReturnValue(createMockSpinner()),
      spyOn(p, "intro").mockImplementation(() => undefined),
      spyOn(p.log, "warn").mockImplementation(() => undefined),
      spyOn(tuiInstallPrompts, "promptInstallPlatform").mockResolvedValue("opencode"),
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
    const promptSpy = spyOn(tuiInstallPrompts, "promptInstallConfig")
    const addPluginSpy = spyOn(configManager, "addPluginToOpenCodeConfig")
    const outroSpy = spyOn(p, "outro").mockImplementation(() => undefined)

    // when
    const result = await runTuiInstaller({ tui: true }, "3.16.0")

    // then
    expect(result).toBe(1)
    expect(promptSpy).not.toHaveBeenCalled()
    expect(addPluginSpy).not.toHaveBeenCalled()
    expect(outroSpy).toHaveBeenCalled()

    for (const spy of restoreSpies) {
      spy.mockRestore()
    }
    promptSpy.mockRestore()
    addPluginSpy.mockRestore()
    outroSpy.mockRestore()
  })

  it("proceeds when OpenCode meets the minimum version", async () => {
    // given
    const restoreSpies = [
      spyOn(p, "spinner").mockReturnValue(createMockSpinner()),
      spyOn(p, "intro").mockImplementation(() => undefined),
      spyOn(p.log, "info").mockImplementation(() => undefined),
      spyOn(p.log, "warn").mockImplementation(() => undefined),
      spyOn(p.log, "success").mockImplementation(() => undefined),
      spyOn(p.log, "message").mockImplementation(() => undefined),
      spyOn(p, "note").mockImplementation(() => undefined),
      spyOn(p, "confirm").mockResolvedValue(false),
      spyOn(p, "outro").mockImplementation(() => undefined),
      spyOn(tuiInstallPrompts, "promptInstallPlatform").mockResolvedValue("opencode"),
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
      spyOn(tuiInstallPrompts, "promptInstallConfig").mockResolvedValue({
        platform: "opencode",
        hasOpenCode: true,
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
        codexAutonomous: false,
      }),
      spyOn(configManager, "addPluginToOpenCodeConfig").mockResolvedValue({
        success: true,
        configPath: "/tmp/opencode.jsonc",
      }),
      spyOn(configManager, "writeOmoConfig").mockReturnValue({
        success: true,
        configPath: "/tmp/oh-my-opencode.jsonc",
      }),
    ]

    // when
    const result = await runTuiInstaller({ tui: true }, "3.16.0")

    // then
    expect(result).toBe(0)

    for (const spy of restoreSpies) {
      spy.mockRestore()
    }
  })

  function createOpenCodeInstallConfig(overrides: Partial<InstallConfig> = {}): InstallConfig {
    return {
      platform: "opencode",
      hasOpenCode: true,
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
      codexAutonomous: false,
      ...overrides,
    }
  }

  it("does not warn about missing providers when only Bailian is configured", async () => {
    const warnSpy = spyOn(p.log, "warn").mockImplementation(() => undefined)
    const restoreSpies = [
      spyOn(p, "spinner").mockReturnValue(createMockSpinner()),
      spyOn(p, "intro").mockImplementation(() => undefined),
      spyOn(p.log, "info").mockImplementation(() => undefined),
      spyOn(p.log, "success").mockImplementation(() => undefined),
      spyOn(p.log, "message").mockImplementation(() => undefined),
      spyOn(p, "note").mockImplementation(() => undefined),
      spyOn(p, "confirm").mockResolvedValue(false),
      spyOn(p, "outro").mockImplementation(() => undefined),
      spyOn(tuiInstallPrompts, "promptInstallPlatform").mockResolvedValue("opencode"),
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
      spyOn(tuiInstallPrompts, "promptInstallConfig").mockResolvedValue(
        createOpenCodeInstallConfig({ hasBailianCodingPlan: true }),
      ),
      spyOn(configManager, "addPluginToOpenCodeConfig").mockResolvedValue({
        success: true,
        configPath: "/tmp/opencode.jsonc",
      }),
      spyOn(configManager, "writeOmoConfig").mockReturnValue({
        success: true,
        configPath: "/tmp/oh-my-opencode.jsonc",
      }),
    ]

    const result = await runTuiInstaller({ tui: true }, "3.16.0")

    expect(result).toBe(0)
    const warnMessages = warnSpy.mock.calls.map((call) => String(call[0]))
    expect(warnMessages.some((m) => m.includes("No model providers configured"))).toBe(false)

    for (const spy of restoreSpies) {
      spy.mockRestore()
    }
    warnSpy.mockRestore()
  })

  it("warns with ultimate fallback when no providers are configured", async () => {
    const warnSpy = spyOn(p.log, "warn").mockImplementation(() => undefined)
    const restoreSpies = [
      spyOn(p, "spinner").mockReturnValue(createMockSpinner()),
      spyOn(p, "intro").mockImplementation(() => undefined),
      spyOn(p.log, "info").mockImplementation(() => undefined),
      spyOn(p.log, "success").mockImplementation(() => undefined),
      spyOn(p.log, "message").mockImplementation(() => undefined),
      spyOn(p, "note").mockImplementation(() => undefined),
      spyOn(p, "confirm").mockResolvedValue(false),
      spyOn(p, "outro").mockImplementation(() => undefined),
      spyOn(tuiInstallPrompts, "promptInstallPlatform").mockResolvedValue("opencode"),
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
      spyOn(tuiInstallPrompts, "promptInstallConfig").mockResolvedValue(createOpenCodeInstallConfig()),
      spyOn(configManager, "addPluginToOpenCodeConfig").mockResolvedValue({
        success: true,
        configPath: "/tmp/opencode.jsonc",
      }),
      spyOn(configManager, "writeOmoConfig").mockReturnValue({
        success: true,
        configPath: "/tmp/oh-my-opencode.jsonc",
      }),
    ]

    const result = await runTuiInstaller({ tui: true }, "3.16.0")

    expect(result).toBe(0)
    const warnMessages = warnSpy.mock.calls.map((call) => String(call[0]))
    expect(warnMessages.some((m) => m.includes(getNoModelProvidersWarning()))).toBe(true)
    expect(warnMessages.some((m) => m.includes(ULTIMATE_FALLBACK))).toBe(true)
    expect(warnMessages.some((m) => m.includes("big-pickle"))).toBe(false)

    for (const spy of restoreSpies) {
      spy.mockRestore()
    }
    warnSpy.mockRestore()
  })

  it("skips OpenCode checks and writes when platform is codex", async () => {
    // given
    const restoreSpies = [
      spyOn(p, "spinner").mockReturnValue(createMockSpinner()),
      spyOn(p, "intro").mockImplementation(() => undefined),
      spyOn(p.log, "info").mockImplementation(() => undefined),
      spyOn(p.log, "warn").mockImplementation(() => undefined),
      spyOn(p.log, "success").mockImplementation(() => undefined),
      spyOn(p.log, "message").mockImplementation(() => undefined),
      spyOn(p, "note").mockImplementation(() => undefined),
      spyOn(p, "confirm").mockResolvedValue(false),
      spyOn(p, "outro").mockImplementation(() => undefined),
      spyOn(tuiInstallPrompts, "promptInstallPlatform").mockResolvedValue("codex"),
      spyOn(tuiInstallPrompts, "promptInstallConfig").mockResolvedValue({
        platform: "codex",
        hasOpenCode: false,
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
        codexAutonomous: false,
      }),
    ]
    const detectConfigSpy = spyOn(configManager, "detectCurrentConfig")
    const isInstalledSpy = spyOn(configManager, "isOpenCodeInstalled")
    const getVersionSpy = spyOn(configManager, "getOpenCodeVersion")
    const addPluginSpy = spyOn(configManager, "addPluginToOpenCodeConfig")
    const writeConfigSpy = spyOn(configManager, "writeOmoConfig")

    // when
    const result = await runTuiInstaller({ tui: true, platform: "codex" }, "3.16.0")

    // then
    expect(result).toBe(0)
    expect(detectConfigSpy).not.toHaveBeenCalled()
    expect(isInstalledSpy).not.toHaveBeenCalled()
    expect(getVersionSpy).not.toHaveBeenCalled()
    expect(addPluginSpy).not.toHaveBeenCalled()
    expect(writeConfigSpy).not.toHaveBeenCalled()

    for (const spy of restoreSpies) {
      spy.mockRestore()
    }
    detectConfigSpy.mockRestore()
    isInstalledSpy.mockRestore()
    getVersionSpy.mockRestore()
    addPluginSpy.mockRestore()
    writeConfigSpy.mockRestore()
  })

  it("stars GitHub repositories when the user confirms", async () => {
    // given
    const restoreSpies = [
      spyOn(p, "spinner").mockReturnValue(createMockSpinner()),
      spyOn(p, "intro").mockImplementation(() => undefined),
      spyOn(p.log, "info").mockImplementation(() => undefined),
      spyOn(p.log, "warn").mockImplementation(() => undefined),
      spyOn(p.log, "success").mockImplementation(() => undefined),
      spyOn(p.log, "message").mockImplementation(() => undefined),
      spyOn(p, "note").mockImplementation(() => undefined),
      spyOn(p, "confirm").mockResolvedValue(true),
      spyOn(p, "outro").mockImplementation(() => undefined),
      spyOn(tuiInstallPrompts, "promptInstallPlatform").mockResolvedValue("opencode"),
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
      spyOn(tuiInstallPrompts, "promptInstallConfig").mockResolvedValue({
        platform: "opencode",
        hasOpenCode: true,
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
        codexAutonomous: false,
      }),
      spyOn(configManager, "addPluginToOpenCodeConfig").mockResolvedValue({
        success: true,
        configPath: "/tmp/opencode.jsonc",
      }),
      spyOn(configManager, "writeOmoConfig").mockReturnValue({
        success: true,
        configPath: "/tmp/oh-my-opencode.jsonc",
      }),
    ]
    const starSpy = spyOn(starRequest, "starGitHubRepositories").mockResolvedValue([
      { repository: "code-yeongyu/oh-my-openagent", ok: true },
      { repository: "code-yeongyu/lazycodex", ok: true },
    ])

    // when
    const result = await runTuiInstaller({ tui: true }, "3.16.0")

    // then
    expect(result).toBe(0)
    expect(starSpy).toHaveBeenCalledTimes(1)
    expect(starSpy).toHaveBeenCalledWith("opencode")

    for (const spy of restoreSpies) {
      spy.mockRestore()
    }
    starSpy.mockRestore()
  })
})
