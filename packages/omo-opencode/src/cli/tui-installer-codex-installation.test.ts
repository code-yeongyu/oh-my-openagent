/// <reference path="../../../../bun-test.d.ts" />
/// <reference types="bun-types" />

import { afterEach, beforeEach, describe, expect, it, spyOn } from "bun:test"
import * as p from "@clack/prompts"
import * as codexInstaller from "./install-codex"
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
