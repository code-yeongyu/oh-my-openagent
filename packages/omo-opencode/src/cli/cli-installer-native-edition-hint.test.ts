import { afterEach, beforeEach, describe, expect, it, mock, spyOn } from "bun:test"
import * as configManager from "./config-manager"
import * as astGrepInstall from "./install-ast-grep-sg"
import * as nativeDevInstaller from "./install-native-dev"
import { runCliInstaller } from "./cli-installer"
import { NATIVE_EDITION_GUIDE_URL, NATIVE_EDITION_INSTALL_COMMAND } from "./native-edition-hint"
import type { InstallArgs } from "./types"

const OPENCODE_ARGS: InstallArgs = {
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

function stubOpenCodeInstall(): void {
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
  spyOn(configManager, "addPluginToOpenCodeConfig").mockResolvedValue({ success: true, configPath: "/tmp/opencode.jsonc" })
  spyOn(configManager, "writeOmoConfig").mockReturnValue({ success: true, configPath: "/tmp/omo.jsonc" })
}

describe("runCliInstaller OmO Native hint", () => {
  const mockConsoleLog = mock(() => {})
  const originalConsoleLog = console.log

  beforeEach(() => {
    console.log = mockConsoleLog
    mockConsoleLog.mockClear()
    spyOn(astGrepInstall, "installAstGrepForOpenCode").mockResolvedValue(undefined)
  })

  afterEach(() => {
    console.log = originalConsoleLog
    mock.restore()
  })

  function printedOutput(): string {
    return mockConsoleLog.mock.calls.map((call) => call.join(" ")).join("\n")
  }

  it("points an OpenCode-edition install at OmO Native with the guide link", async () => {
    // given
    stubOpenCodeInstall()

    // when
    const result = await runCliInstaller(OPENCODE_ARGS, "3.4.0")

    // then
    expect(result).toBe(0)
    const output = printedOutput()
    expect(output).toContain(NATIVE_EDITION_INSTALL_COMMAND)
    expect(output).toContain(NATIVE_EDITION_GUIDE_URL)
  })

  it("stays silent about OmO Native when the install target is the native development adapter", async () => {
    // given
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
    const result = await runCliInstaller({ tui: false, platform: "native-dev" }, "3.4.0")

    // then
    expect(result).toBe(0)
    expect(printedOutput()).not.toContain(NATIVE_EDITION_INSTALL_COMMAND)
  })
})
