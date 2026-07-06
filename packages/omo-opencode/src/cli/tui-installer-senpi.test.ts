import { afterEach, beforeEach, describe, expect, it, mock, spyOn } from "bun:test"
import * as p from "@clack/prompts"

import * as configManager from "./config-manager"
import * as astGrepInstall from "./install-ast-grep-sg"
import * as senpiInstaller from "./install-senpi"
import * as tuiInstallPrompts from "./tui-install-prompts"
import { runTuiInstaller } from "./tui-installer"

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

describe("runTuiInstaller Senpi platform", () => {
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
    mock.restore()
  })

  it("executes Senpi adapter install when platform is senpi", async () => {
    // given
    spyOn(p, "spinner").mockReturnValue(createMockSpinner())
    spyOn(p, "intro").mockImplementation(() => undefined)
    spyOn(p.log, "info").mockImplementation(() => undefined)
    spyOn(p.log, "warn").mockImplementation(() => undefined)
    spyOn(p.log, "success").mockImplementation(() => undefined)
    spyOn(p.log, "message").mockImplementation(() => undefined)
    spyOn(p, "note").mockImplementation(() => undefined)
    spyOn(p, "confirm").mockResolvedValue(false)
    spyOn(p, "outro").mockImplementation(() => undefined)
    spyOn(tuiInstallPrompts, "promptInstallPlatform").mockResolvedValue("senpi")
    spyOn(tuiInstallPrompts, "promptInstallConfig").mockResolvedValue({
      platform: "senpi",
      hasOpenCode: false,
      hasClaude: false,
      isMax20: false,
      hasOpenAI: false,
      hasGemini: false,
      hasCopilot: false,
      hasCodex: false,
      hasSenpi: true,
      hasOpencodeZen: false,
      hasZaiCodingPlan: false,
      hasKimiForCoding: false,
      hasOpencodeGo: false,
      hasBailianCodingPlan: false,
      hasMinimaxCnCodingPlan: false,
      hasMinimaxCodingPlan: false,
      hasVercelAiGateway: false,
      codexAutonomous: false,
    })
    const detectConfigSpy = spyOn(configManager, "detectCurrentConfig")
    const addPluginSpy = spyOn(configManager, "addPluginToOpenCodeConfig")
    const senpiSpy = spyOn(senpiInstaller, "runSenpiInstaller").mockResolvedValue({
      agentDir: "/tmp/senpi-agent",
      settingsPath: "/tmp/senpi-agent/settings.json",
      pluginPath: "/tmp/repo/packages/omo-senpi/plugin",
      changed: true,
      backupPath: "/tmp/senpi-agent/settings.json.20260703T000000000Z.backup",
    })

    // when
    const result = await runTuiInstaller({ tui: true, platform: "senpi" }, "3.16.0")

    // then
    expect(result).toBe(0)
    expect(detectConfigSpy).not.toHaveBeenCalled()
    expect(addPluginSpy).not.toHaveBeenCalled()
    expect(senpiSpy).toHaveBeenCalledTimes(1)
  })
})
