import { afterEach, beforeEach, describe, expect, it, spyOn } from "bun:test"
import * as p from "@clack/prompts"
import * as configManager from "./config-manager"
import * as tuiInstallPrompts from "./tui-install-prompts"
import { runTuiInstaller } from "./tui-installer"

function createMockSpinner(): ReturnType<typeof p.spinner> {
  return {
    start: () => undefined,
    stop: () => undefined,
    message: () => undefined,
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
      spyOn(configManager, "detectCurrentConfig").mockReturnValue({
        isInstalled: false,
        installedVersion: null,
        hasClaude: false,
        isMax20: false,
        hasOpenAI: false,
        hasGemini: false,
        hasCopilot: false,
        hasOpencodeZen: false,
        hasZaiCodingPlan: false,
        hasKimiForCoding: false,
        hasOpencodeGo: false,
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
      spyOn(p, "outro").mockImplementation(() => undefined),
      spyOn(configManager, "detectCurrentConfig").mockReturnValue({
        isInstalled: false,
        installedVersion: null,
        hasClaude: false,
        isMax20: false,
        hasOpenAI: false,
        hasGemini: false,
        hasCopilot: false,
        hasOpencodeZen: false,
        hasZaiCodingPlan: false,
        hasKimiForCoding: false,
        hasOpencodeGo: false,
      }),
      spyOn(configManager, "isOpenCodeInstalled").mockResolvedValue(true),
      spyOn(configManager, "getOpenCodeVersion").mockResolvedValue("1.4.0"),
      spyOn(tuiInstallPrompts, "promptInstallConfig").mockResolvedValue({
        hasClaude: false,
        isMax20: false,
        hasOpenAI: false,
        hasGemini: false,
        hasCopilot: false,
        hasOpencodeZen: false,
        hasZaiCodingPlan: false,
        hasKimiForCoding: false,
        hasOpencodeGo: false,
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
})
