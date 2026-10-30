import { afterEach, beforeEach, describe, expect, it, mock, spyOn } from "bun:test"
import * as p from "@clack/prompts"
import * as configManager from "./config-manager"
import * as astGrepInstall from "./install-ast-grep-sg"
import * as nativeDevInstaller from "./install-native-dev"
import * as tuiInstallPrompts from "./tui-install-prompts"
import { NATIVE_EDITION_GUIDE_URL, NATIVE_EDITION_INSTALL_COMMAND } from "./native-edition-hint"
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

function installConfig(platform: "opencode" | "native-dev"): InstallConfig {
  return {
    platform,
    hasOpenCode: platform === "opencode",
    hasClaude: false,
    isMax20: false,
    hasOpenAI: false,
    hasGemini: false,
    hasCopilot: false,
    hasCodex: false,
    hasNativeDev: platform === "native-dev",
    hasOpencodeZen: false,
    hasZaiCodingPlan: false,
    hasKimiForCoding: false,
    hasOpencodeGo: false,
    hasBailianCodingPlan: false,
    hasMinimaxCnCodingPlan: false,
    hasMinimaxCodingPlan: false,
    hasVercelAiGateway: false,
    codexAutonomous: false,
  }
}

describe("runTuiInstaller OmO Native hint", () => {
  const originalIsStdinTty = process.stdin.isTTY
  const originalIsStdoutTty = process.stdout.isTTY
  const printed: string[] = []

  beforeEach(() => {
    Object.defineProperty(process.stdin, "isTTY", { configurable: true, value: true })
    Object.defineProperty(process.stdout, "isTTY", { configurable: true, value: true })
    printed.length = 0
    const record = (...parts: unknown[]) => {
      printed.push(parts.map(String).join(" "))
    }
    spyOn(p, "spinner").mockReturnValue(createMockSpinner())
    spyOn(p, "intro").mockImplementation(() => undefined)
    spyOn(p.log, "info").mockImplementation(record)
    spyOn(p.log, "warn").mockImplementation(record)
    spyOn(p.log, "success").mockImplementation(record)
    spyOn(p.log, "message").mockImplementation(record)
    spyOn(p, "note").mockImplementation(record)
    spyOn(p, "confirm").mockResolvedValue(false)
    spyOn(p, "outro").mockImplementation(() => undefined)
    spyOn(astGrepInstall, "installAstGrepForOpenCode").mockResolvedValue(undefined)
  })

  afterEach(() => {
    Object.defineProperty(process.stdin, "isTTY", { configurable: true, value: originalIsStdinTty })
    Object.defineProperty(process.stdout, "isTTY", { configurable: true, value: originalIsStdoutTty })
    mock.restore()
  })

  it("points an OpenCode-edition install at OmO Native with the guide link", async () => {
    // given
    spyOn(tuiInstallPrompts, "promptInstallPlatform").mockResolvedValue("opencode")
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
    })
    spyOn(configManager, "isOpenCodeInstalled").mockResolvedValue(true)
    spyOn(configManager, "getOpenCodeVersion").mockResolvedValue("1.4.0")
    spyOn(tuiInstallPrompts, "promptInstallConfig").mockResolvedValue(installConfig("opencode"))
    spyOn(configManager, "addPluginToOpenCodeConfig").mockResolvedValue({ success: true, configPath: "/tmp/opencode.jsonc" })
    spyOn(configManager, "writeOmoConfig").mockReturnValue({ success: true, configPath: "/tmp/omo.jsonc" })

    // when
    const result = await runTuiInstaller({ tui: true }, "3.16.0")

    // then
    expect(result).toBe(0)
    const output = printed.join("\n")
    expect(output).toContain(NATIVE_EDITION_INSTALL_COMMAND)
    expect(output).toContain(NATIVE_EDITION_GUIDE_URL)
  })

  it("stays silent about OmO Native when the install target is the native development adapter", async () => {
    // given
    spyOn(tuiInstallPrompts, "promptInstallPlatform").mockResolvedValue("native-dev")
    spyOn(tuiInstallPrompts, "promptInstallConfig").mockResolvedValue(installConfig("native-dev"))
    spyOn(nativeDevInstaller, "runNativeDevInstaller").mockResolvedValue({
      ok: true,
      action: "install",
      agentDir: "/tmp/omo-agent",
      settingsPath: "/tmp/omo-agent/settings.json",
      pluginPath: "/tmp/repo/packages/omo-senpi/plugin",
      changed: true,
      backupPath: "/tmp/omo-agent/settings.json.20260921T000000000Z.backup",
    })

    // when
    const result = await runTuiInstaller({ tui: true, platform: "native-dev" }, "3.16.0")

    // then
    expect(result).toBe(0)
    expect(printed.join("\n")).not.toContain(NATIVE_EDITION_INSTALL_COMMAND)
  })
})
