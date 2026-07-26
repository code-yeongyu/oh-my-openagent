/// <reference path="../../../../bun-test.d.ts" />
/// <reference types="bun-types" />

import { afterEach, beforeEach, describe, expect, it, spyOn } from "bun:test"
import * as p from "@clack/prompts"
import * as configManager from "./config-manager"
import * as astGrepInstall from "./install-ast-grep-sg"
import * as codexInstaller from "./install-codex"
import * as tuiConfig from "./config-manager/add-tui-plugin-to-tui-config"
import * as tuiInstallPrompts from "./tui-install-prompts"
import { runTuiInstaller } from "./tui-installer"
import type { CodexInstallResult } from "./install-codex"

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

const codexResult: CodexInstallResult = {
  marketplaceName: "sisyphuslabs",
  installed: [],
  configPath: "/tmp/codex/config.toml",
  codexHome: "/tmp/codex",
  gitBashPath: null,
  projectCleanup: {
    projectRoot: null,
    configPath: null,
    changed: false,
    removedKeys: [],
    configs: [],
    artifacts: [],
  },
}

describe("runTuiInstaller Codex installation detection", () => {
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

  it("#given Codex is missing #when installing Codex interactively #then warns and still installs", async () => {
    // given
    const restoreSpies = [
      spyOn(p, "spinner").mockReturnValue(createMockSpinner()),
      spyOn(p, "intro").mockImplementation(() => undefined),
      spyOn(p.log, "info").mockImplementation(() => undefined),
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
        hasCodex: true,
        hasOpencodeZen: false,
        hasZaiCodingPlan: false,
        hasKimiForCoding: false,
        hasOpencodeGo: false,
      hasBailianCodingPlan: false,
        hasVercelAiGateway: false,
        codexAutonomous: false,
      }),
    ]
    const warnSpy = spyOn(p.log, "warn").mockImplementation(() => undefined)
    const detectSpy = spyOn(codexInstaller, "detectCodexInstallation").mockResolvedValue({
      found: false,
      checkedPaths: ["codex (PATH)"],
      hint: "Install OpenAI Codex CLI first.",
    })
    const installSpy = spyOn(codexInstaller, "runCodexInstaller").mockResolvedValue(codexResult)

    // when
    const result = await runTuiInstaller({ tui: true, platform: "codex" }, "3.16.0")

    // then
    const warningText = warnSpy.mock.calls.map((call) => String(call[0])).join("\n")
    expect(result).toBe(0)
    expect(detectSpy).toHaveBeenCalledTimes(1)
    expect(warningText).toContain("Codex CLI or desktop app was not detected")
    expect(installSpy).toHaveBeenCalledWith({ autonomousPermissions: false })

    for (const spy of restoreSpies) {
      spy.mockRestore()
    }
    warnSpy.mockRestore()
    detectSpy.mockRestore()
    installSpy.mockRestore()
  })

  it("#given Codex is installed #when installing Codex interactively #then suppresses the missing-install warning", async () => {
    // given
    const restoreSpies = [
      spyOn(p, "spinner").mockReturnValue(createMockSpinner()),
      spyOn(p, "intro").mockImplementation(() => undefined),
      spyOn(p.log, "info").mockImplementation(() => undefined),
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
        hasCodex: true,
        hasOpencodeZen: false,
        hasZaiCodingPlan: false,
        hasKimiForCoding: false,
        hasOpencodeGo: false,
      hasBailianCodingPlan: false,
        hasVercelAiGateway: false,
        codexAutonomous: true,
      }),
    ]
    const warnSpy = spyOn(p.log, "warn").mockImplementation(() => undefined)
    const detectSpy = spyOn(codexInstaller, "detectCodexInstallation").mockResolvedValue({
      found: true,
      source: "cli",
      path: "/opt/homebrew/bin/codex",
    })
    const installSpy = spyOn(codexInstaller, "runCodexInstaller").mockResolvedValue(codexResult)

    // when
    const result = await runTuiInstaller({ tui: true, platform: "codex" }, "3.16.0")

    // then
    const warningText = warnSpy.mock.calls.map((call) => String(call[0])).join("\n")
    expect(result).toBe(0)
    expect(detectSpy).toHaveBeenCalledTimes(1)
    expect(warningText).not.toContain("Codex CLI or desktop app was not detected")
    expect(installSpy).toHaveBeenCalledWith({ autonomousPermissions: true })

    for (const spy of restoreSpies) {
      spy.mockRestore()
    }
    warnSpy.mockRestore()
    detectSpy.mockRestore()
    installSpy.mockRestore()
  })
})

describe("runTuiInstaller Codex install failure exit status", () => {
  const originalIsStdinTty = process.stdin.isTTY
  const originalIsStdoutTty = process.stdout.isTTY

  beforeEach(() => {
    Object.defineProperty(process.stdin, "isTTY", { configurable: true, value: true })
    Object.defineProperty(process.stdout, "isTTY", { configurable: true, value: true })
    spyOn(astGrepInstall, "installAstGrepForOpenCode").mockResolvedValue(undefined)
  })

  afterEach(() => {
    Object.defineProperty(process.stdin, "isTTY", { configurable: true, value: originalIsStdinTty })
    Object.defineProperty(process.stdout, "isTTY", { configurable: true, value: originalIsStdoutTty })
  })

  it("#given a Codex-only install whose Codex step fails #when the installer runs #then it reports failure and the exit status is non-zero", async () => {
    // given
    const errorSpy = spyOn(p.log, "error").mockImplementation(() => undefined)
    const outroSpy = spyOn(p, "outro").mockImplementation(() => undefined)
    const restoreSpies = [
      spyOn(p, "spinner").mockReturnValue(createMockSpinner()),
      spyOn(p, "intro").mockImplementation(() => undefined),
      spyOn(p.log, "info").mockImplementation(() => undefined),
      spyOn(p.log, "success").mockImplementation(() => undefined),
      spyOn(p.log, "message").mockImplementation(() => undefined),
      spyOn(p.log, "warn").mockImplementation(() => undefined),
      spyOn(p, "note").mockImplementation(() => undefined),
      spyOn(p, "confirm").mockResolvedValue(false),
      spyOn(tuiInstallPrompts, "promptInstallPlatform").mockResolvedValue("codex"),
      spyOn(tuiInstallPrompts, "promptInstallConfig").mockResolvedValue({
        platform: "codex",
        hasOpenCode: false,
        hasClaude: false,
        isMax20: false,
        hasOpenAI: false,
        hasGemini: false,
        hasCopilot: false,
        hasCodex: true,
        hasSenpi: false,
        hasOpencodeZen: false,
        hasZaiCodingPlan: false,
        hasKimiForCoding: false,
        hasOpencodeGo: false,
        hasBailianCodingPlan: false,
        hasMinimaxCnCodingPlan: false,
        hasMinimaxCodingPlan: false,
        hasVercelAiGateway: false,
        codexAutonomous: true,
      }),
      spyOn(codexInstaller, "detectCodexInstallation").mockResolvedValue({
        found: true,
        source: "cli",
        path: "/opt/homebrew/bin/codex",
      }),
    ]
    const installSpy = spyOn(codexInstaller, "runCodexInstaller").mockRejectedValue(new Error("codex failed"))

    // when
    const result = await runTuiInstaller({ tui: true, platform: "codex" }, "3.16.0")

    // then
    const errorText = errorSpy.mock.calls.map((call) => String(call[0])).join("\n")
    const outroText = outroSpy.mock.calls.map((call) => String(call[0])).join("\n")
    expect(result).toBe(1)
    expect(errorText).toContain("Codex install failed: codex failed")
    expect(outroText).toContain("Installation failed.")

    for (const spy of restoreSpies) {
      spy.mockRestore()
    }
    errorSpy.mockRestore()
    outroSpy.mockRestore()
    installSpy.mockRestore()
  })

  it("#given platform=both where OpenCode succeeds and Codex fails #when the installer runs #then the partial-success warning path is preserved", async () => {
    // given
    const warnSpy = spyOn(p.log, "warn").mockImplementation(() => undefined)
    const errorSpy = spyOn(p.log, "error").mockImplementation(() => undefined)
    const restoreSpies = [
      spyOn(p, "spinner").mockReturnValue(createMockSpinner()),
      spyOn(p, "intro").mockImplementation(() => undefined),
      spyOn(p.log, "info").mockImplementation(() => undefined),
      spyOn(p.log, "success").mockImplementation(() => undefined),
      spyOn(p.log, "message").mockImplementation(() => undefined),
      spyOn(p, "note").mockImplementation(() => undefined),
      spyOn(p, "confirm").mockResolvedValue(false),
      spyOn(p, "outro").mockImplementation(() => undefined),
      spyOn(tuiInstallPrompts, "promptInstallPlatform").mockResolvedValue("both"),
      spyOn(tuiInstallPrompts, "promptInstallConfig").mockResolvedValue({
        platform: "both",
        hasOpenCode: true,
        hasClaude: false,
        isMax20: false,
        hasOpenAI: false,
        hasGemini: false,
        hasCopilot: false,
        hasCodex: true,
        hasSenpi: false,
        hasOpencodeZen: false,
        hasZaiCodingPlan: false,
        hasKimiForCoding: false,
        hasOpencodeGo: false,
        hasBailianCodingPlan: false,
        hasMinimaxCnCodingPlan: false,
        hasMinimaxCodingPlan: false,
        hasVercelAiGateway: false,
        codexAutonomous: true,
      }),
      spyOn(configManager, "detectCurrentConfig").mockReturnValue({
        isInstalled: true,
        installedVersion: "1.4.0",
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
      spyOn(tuiConfig, "ensureTuiPluginEntry").mockReturnValue({ changed: false, reason: "no-server-entry" }),
      spyOn(codexInstaller, "detectCodexInstallation").mockResolvedValue({
        found: true,
        source: "cli",
        path: "/opt/homebrew/bin/codex",
      }),
    ]
    const installSpy = spyOn(codexInstaller, "runCodexInstaller").mockRejectedValue(new Error("codex failed"))

    // when
    const result = await runTuiInstaller({ tui: true, platform: "both" }, "3.16.0")

    // then
    const warningText = warnSpy.mock.calls.map((call) => String(call[0])).join("\n")
    expect(result).toBe(0)
    expect(warningText).toContain("Codex install failed (OpenCode install remains successful): codex failed")
    expect(errorSpy).not.toHaveBeenCalled()

    for (const spy of restoreSpies) {
      spy.mockRestore()
    }
    warnSpy.mockRestore()
    errorSpy.mockRestore()
    installSpy.mockRestore()
  })
})
