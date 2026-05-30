/// <reference types="bun-types" />

import { afterEach, beforeEach, describe, expect, mock, spyOn, test } from "bun:test"
import { runCliInstaller } from "./cli-installer"
import * as configManager from "./config-manager"
import * as codexInstaller from "./install-codex"
import type { CodexInstallResult } from "./install-codex"
import type { InstallArgs } from "./types"

const codexResult: CodexInstallResult = {
  marketplaceName: "sisyphuslabs",
  installed: [],
  configPath: "/tmp/codex-config.toml",
  codexHome: "/tmp/codex-home",
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
  const originalPublishLazycodex = process.env.OMO_PUBLISH_LAZYCODEX

  beforeEach(() => {
    consoleLogMock.mockClear()
    console.log = consoleLogMock
    process.env.OMO_PUBLISH_LAZYCODEX = "true"
  })

  afterEach(() => {
    console.log = consoleLog
    if (originalPublishLazycodex === undefined) {
      delete process.env.OMO_PUBLISH_LAZYCODEX
    } else {
      process.env.OMO_PUBLISH_LAZYCODEX = originalPublishLazycodex
    }
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
    expect(codexSpy).toHaveBeenCalledTimes(1)
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

  test("runs OpenCode and Codex installation for platform=both", async () => {
    // given
    stubOpenCodeSuccess()
    const codexSpy = spyOn(codexInstaller, "runCodexInstaller").mockResolvedValue(codexResult)
    const writeSpy = spyOn(configManager, "writeOmoConfig")

    // when
    const result = await runCliInstaller(createOpenCodeArgs("both"), "3.4.0")

    // then
    expect(result).toBe(0)
    expect(writeSpy).toHaveBeenCalledTimes(1)
    expect(codexSpy).toHaveBeenCalledTimes(1)
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

  test("prints star commands for OpenAgent and LazyCodex", async () => {
    // given
    stubOpenCodeSuccess()
    spyOn(codexInstaller, "runCodexInstaller").mockResolvedValue(codexResult)

    // when
    const result = await runCliInstaller(createOpenCodeArgs("both"), "3.4.0")

    // then
    const output = consoleLogMock.mock.calls.map((call) => call.join(" ")).join("\n")
    expect(result).toBe(0)
    expect(output).toContain("/user/starred/code-yeongyu/oh-my-openagent")
    expect(output).toContain("/user/starred/code-yeongyu/lazycodex")
  })
})
