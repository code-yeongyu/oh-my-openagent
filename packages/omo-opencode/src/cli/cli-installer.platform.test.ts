/// <reference types="bun-types" />

import { afterEach, beforeEach, describe, expect, mock, spyOn, test } from "bun:test"
import { runCliInstaller } from "./cli-installer"
import * as configManager from "./config-manager"
import * as astGrepInstall from "./install-ast-grep-sg"
import * as codexInstaller from "./install-codex"
import * as senpiInstaller from "./install-senpi"
import type { CodexInstallResult } from "./install-codex"
import type { InstallArgs } from "./types"

const codexResult: CodexInstallResult = {
  marketplaceName: "sisyphuslabs",
  installed: [],
  configPath: "/tmp/codex-config.toml",
  codexHome: "/tmp/codex-home",
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

const senpiResult = {
  agentDir: "/tmp/senpi-agent",
  settingsPath: "/tmp/senpi-agent/settings.json",
  pluginPath: "/tmp/repo/packages/omo-senpi/plugin",
  changed: true,
  backupPath: "/tmp/senpi-agent/settings.json.20260703T000000000Z.backup",
}

function createOpenCodeArgs(platform: "opencode" | "both"): InstallArgs {
  return {
    tui: false,
    platform,
    claude: "no",
    openai: "no",
    gemini: "no",
    copilot: "no",
    opencodeZen: "no",
    zaiCodingPlan: "no",
    kimiForCoding: "no",
    opencodeGo: "no",
    vercelAiGateway: "no",
  }
}

function stubOpenCodeSuccess(): void {
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
  })
  spyOn(configManager, "isOpenCodeInstalled").mockResolvedValue(true)
  spyOn(configManager, "getOpenCodeVersion").mockResolvedValue("1.4.0")
  spyOn(configManager, "addPluginToOpenCodeConfig").mockResolvedValue({
    success: true,
    configPath: "/tmp/opencode.jsonc",
  })
  spyOn(configManager, "writeOmoConfig").mockReturnValue({
    success: true,
    configPath: "/tmp/oh-my-opencode.jsonc",
  })
}

describe("runCliInstaller platform branching", () => {
  const consoleLogMock = mock(() => {})
  const consoleLog = console.log

  beforeEach(() => {
    consoleLogMock.mockClear()
    console.log = consoleLogMock
    spyOn(astGrepInstall, "installAstGrepForOpenCode").mockResolvedValue(undefined)
  })

  afterEach(() => {
    console.log = consoleLog
    mock.restore()
  })

  test("runs only OpenCode installation for platform=opencode", async () => {
    // given
    stubOpenCodeSuccess()
    const codexSpy = spyOn(codexInstaller, "runCodexInstaller").mockResolvedValue(codexResult)
    const writeSpy = spyOn(configManager, "writeOmoConfig")

    // when
    const result = await runCliInstaller(createOpenCodeArgs("opencode"), "3.4.0")

    // then
    expect(result).toBe(0)
    expect(writeSpy).toHaveBeenCalledTimes(1)
    expect(codexSpy).not.toHaveBeenCalled()
  })

  test("runs only Codex installation and skips OpenCode version checks for platform=codex", async () => {
    // given
    const versionSpy = spyOn(configManager, "getOpenCodeVersion")
    const writeSpy = spyOn(configManager, "writeOmoConfig")
    const codexSpy = spyOn(codexInstaller, "runCodexInstaller").mockResolvedValue(codexResult)

    // when
    const result = await runCliInstaller({ tui: false, platform: "codex" }, "3.4.0")

    // then
    expect(result).toBe(0)
    expect(versionSpy).not.toHaveBeenCalled()
    expect(writeSpy).not.toHaveBeenCalled()
    expect(codexSpy).toHaveBeenCalledWith({ autonomousPermissions: true })
  })

  test("runs only Senpi installation and skips OpenCode provider checks for platform=senpi", async () => {
    // given
    const versionSpy = spyOn(configManager, "getOpenCodeVersion")
    const writeSpy = spyOn(configManager, "writeOmoConfig")
    const codexSpy = spyOn(codexInstaller, "runCodexInstaller").mockResolvedValue(codexResult)
    const senpiSpy = spyOn(senpiInstaller, "runSenpiInstaller").mockResolvedValue(senpiResult)

    // when
    const result = await runCliInstaller({ tui: false, platform: "senpi" }, "3.4.0")

    // then
    expect(result).toBe(0)
    expect(versionSpy).not.toHaveBeenCalled()
    expect(writeSpy).not.toHaveBeenCalled()
    expect(codexSpy).not.toHaveBeenCalled()
    expect(senpiSpy).toHaveBeenCalledTimes(1)
  })

  test("passes Codex autonomous selection into Codex installer", async () => {
    // given
    const codexSpy = spyOn(codexInstaller, "runCodexInstaller").mockResolvedValue(codexResult)

    // when
    const result = await runCliInstaller({ tui: false, platform: "codex", codexAutonomous: true }, "3.4.0")

    // then
    expect(result).toBe(0)
    expect(codexSpy).toHaveBeenCalledWith({ autonomousPermissions: true })
  })

  test("passes explicit Codex autonomous opt-out into Codex installer", async () => {
    // given
    const codexSpy = spyOn(codexInstaller, "runCodexInstaller").mockResolvedValue(codexResult)

    // when
    const result = await runCliInstaller({ tui: false, platform: "codex", codexAutonomous: false }, "3.4.0")

    // then
    expect(result).toBe(0)
    expect(codexSpy).toHaveBeenCalledWith({ autonomousPermissions: false })
  })

  test("runs OpenCode and Codex installation for platform=both", async () => {
    // given
    stubOpenCodeSuccess()
    const codexSpy = spyOn(codexInstaller, "runCodexInstaller").mockResolvedValue(codexResult)
    const senpiSpy = spyOn(senpiInstaller, "runSenpiInstaller").mockResolvedValue(senpiResult)
    const writeSpy = spyOn(configManager, "writeOmoConfig")

    // when
    const result = await runCliInstaller(createOpenCodeArgs("both"), "3.4.0")

    // then
    expect(result).toBe(0)
    expect(writeSpy).toHaveBeenCalledTimes(1)
    expect(codexSpy).toHaveBeenCalledTimes(1)
    expect(senpiSpy).not.toHaveBeenCalled()
  })

  test("fails when Senpi-only installation cannot install Senpi", async () => {
    // given
    spyOn(senpiInstaller, "runSenpiInstaller").mockRejectedValue(new Error("senpi failed"))

    // when
    const result = await runCliInstaller({ tui: false, platform: "senpi" }, "3.4.0")

    // then
    expect(result).toBe(1)
  })

  test("fails when Codex-only installation cannot install Codex", async () => {
    // given
    spyOn(codexInstaller, "runCodexInstaller").mockRejectedValue(new Error("codex failed"))

    // when
    const result = await runCliInstaller({ tui: false, platform: "codex" }, "3.4.0")

    // then
    expect(result).toBe(1)
  })

  test("keeps OpenCode success when Codex fails for platform=both", async () => {
    // given
    stubOpenCodeSuccess()
    spyOn(codexInstaller, "runCodexInstaller").mockRejectedValue(new Error("codex failed"))

    // when
    const result = await runCliInstaller(createOpenCodeArgs("both"), "3.4.0")

    // then
    expect(result).toBe(0)
  })

  test("does not print star commands in noninteractive installs", async () => {
    // given
    stubOpenCodeSuccess()
    spyOn(codexInstaller, "runCodexInstaller").mockResolvedValue(codexResult)

    // when
    const result = await runCliInstaller(createOpenCodeArgs("both"), "3.4.0")

    // then
    const output = consoleLogMock.mock.calls.map((call) => call.join(" ")).join("\n")
    expect(result).toBe(0)
    expect(output).not.toContain("/user/starred/code-yeongyu/oh-my-openagent")
    expect(output).not.toContain("/user/starred/code-yeongyu/lazycodex")
  })

  test("does not prompt for GitHub stars in noninteractive installs even when stdout is a TTY", async () => {
    // given
    stubOpenCodeSuccess()
    const questionMock = mock(async () => "n")
    const closeMock = mock(() => {})
    mock.module("node:readline/promises", () => ({
      createInterface: mock(() => ({
        question: questionMock,
        close: closeMock,
      })),
    }))
    const stdinDescriptor = Object.getOwnPropertyDescriptor(process.stdin, "isTTY")
    const stdoutDescriptor = Object.getOwnPropertyDescriptor(process.stdout, "isTTY")
    Object.defineProperty(process.stdin, "isTTY", { configurable: true, value: true })
    Object.defineProperty(process.stdout, "isTTY", { configurable: true, value: true })
    const importKey = `non-tui-star-${Date.now()}-${Math.random()}`
    const { runCliInstaller: runCliInstallerWithReadlineMock } = await import(`./cli-installer?${importKey}`)

    try {
      // when
      const result = await runCliInstallerWithReadlineMock(createOpenCodeArgs("opencode"), "3.4.0")

      // then
      expect(result).toBe(0)
      expect(questionMock).not.toHaveBeenCalled()
      expect(closeMock).not.toHaveBeenCalled()
    } finally {
      if (stdinDescriptor) {
        Object.defineProperty(process.stdin, "isTTY", stdinDescriptor)
      }
      if (stdoutDescriptor) {
        Object.defineProperty(process.stdout, "isTTY", stdoutDescriptor)
      }
    }
  })
})
