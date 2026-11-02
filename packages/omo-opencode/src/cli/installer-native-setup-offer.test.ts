import { afterEach, beforeEach, describe, expect, it, mock, spyOn } from "bun:test"
import * as p from "@clack/prompts"

import * as spawnModule from "../shared/spawn-with-windows-hide"
import type { SpawnedProcess } from "../shared/spawn-with-windows-hide"
import { runCliInstaller } from "./cli-installer"
import * as astGrepInstall from "./install-ast-grep-sg"
import * as installNative from "./install-native"
import type { NativeInstallOutcome } from "./install-native"
import * as tuiInstallPrompts from "./tui-install-prompts"
import { runTuiInstaller } from "./tui-installer"
import type { InstallConfig } from "./types"

const VERIFIED_BIN = "/sandbox/.bun/bin/omo"

const NATIVE_CONFIG: InstallConfig = {
  platform: "native",
  hasOpenCode: false,
  hasClaude: false,
  isMax20: false,
  hasOpenAI: false,
  hasGemini: false,
  hasCopilot: false,
  hasCodex: false,
  hasNative: true,
  hasNativeDev: false,
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

function outcome(verified: boolean): NativeInstallOutcome {
  return {
    ok: true,
    verified,
    ...(verified ? { omoBinPath: VERIFIED_BIN } : {}),
    plan: { packageManager: "bun", command: "bun", args: ["add", "-g", "omo-ai@beta"] },
    notes: [],
    warnings: verified ? [] : ['Put omo-ai first: export PATH="/sandbox/.bun/bin:$PATH"'],
  }
}

function fakeProcess(exitCode: number): SpawnedProcess {
  return { exitCode, exited: Promise.resolve(exitCode), stdout: undefined, stderr: undefined, kill: () => undefined }
}

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

function setupQuestionsAsked(confirmSpy: ReturnType<typeof spyOn>): number {
  return confirmSpy.mock.calls.filter(
    (call: unknown[]) => (call[0] as { message?: string }).message === installNative.NATIVE_SETUP_OFFER_QUESTION,
  ).length
}

describe("runTuiInstaller offers omo setup after a native install", () => {
  const originalIsStdinTty = process.stdin.isTTY
  const originalIsStdoutTty = process.stdout.isTTY

  beforeEach(() => {
    Object.defineProperty(process.stdin, "isTTY", { configurable: true, value: true })
    Object.defineProperty(process.stdout, "isTTY", { configurable: true, value: true })
    spyOn(astGrepInstall, "installAstGrepForOpenCode").mockResolvedValue(undefined)
    spyOn(p, "spinner").mockReturnValue(createMockSpinner())
    spyOn(p, "intro").mockImplementation(() => undefined)
    spyOn(p.log, "info").mockImplementation(() => undefined)
    spyOn(p.log, "warn").mockImplementation(() => undefined)
    spyOn(p.log, "step").mockImplementation(() => undefined)
    spyOn(p.log, "success").mockImplementation(() => undefined)
    spyOn(p.log, "message").mockImplementation(() => undefined)
    spyOn(p, "note").mockImplementation(() => undefined)
    spyOn(p, "outro").mockImplementation(() => undefined)
    spyOn(tuiInstallPrompts, "promptInstallPlatform").mockResolvedValue("native")
    spyOn(tuiInstallPrompts, "promptInstallConfig").mockResolvedValue(NATIVE_CONFIG)
  })

  afterEach(() => {
    Object.defineProperty(process.stdin, "isTTY", { configurable: true, value: originalIsStdinTty })
    Object.defineProperty(process.stdout, "isTTY", { configurable: true, value: originalIsStdoutTty })
    mock.restore()
  })

  function answerSetup(answer: boolean): ReturnType<typeof spyOn> {
    return spyOn(p, "confirm").mockImplementation(async (options: { message: string }) =>
      options.message === installNative.NATIVE_SETUP_OFFER_QUESTION ? answer : false,
    )
  }

  it("#given a verified install #when the user accepts #then the verified omo binary runs setup on the terminal", async () => {
    // given
    spyOn(installNative, "runNativeInstall").mockResolvedValue(outcome(true))
    const confirmSpy = answerSetup(true)
    const spawnSpy = spyOn(spawnModule, "spawnWithWindowsHide").mockReturnValue(fakeProcess(0))

    // when
    const result = await runTuiInstaller({ tui: true, platform: "native" }, "5.0.0-beta.89")

    // then
    expect(result).toBe(0)
    expect(setupQuestionsAsked(confirmSpy)).toBe(1)
    expect(spawnSpy).toHaveBeenCalledTimes(1)
    const [argv, options] = spawnSpy.mock.calls[0] as [string[], spawnModule.SpawnOptions]
    expect(argv).toEqual([VERIFIED_BIN, "setup"])
    expect(options.stdin).toBe("inherit")
  })

  it("#given a verified install #when the user declines #then setup is not run", async () => {
    // given
    spyOn(installNative, "runNativeInstall").mockResolvedValue(outcome(true))
    const confirmSpy = answerSetup(false)
    const spawnSpy = spyOn(spawnModule, "spawnWithWindowsHide").mockReturnValue(fakeProcess(0))

    // when
    const result = await runTuiInstaller({ tui: true, platform: "native" }, "5.0.0-beta.89")

    // then
    expect(result).toBe(0)
    expect(setupQuestionsAsked(confirmSpy)).toBe(1)
    expect(spawnSpy).not.toHaveBeenCalled()
  })

  it("#given verify failed #when the install finishes #then setup is neither offered nor run", async () => {
    // given
    spyOn(installNative, "runNativeInstall").mockResolvedValue(outcome(false))
    const confirmSpy = answerSetup(true)
    const spawnSpy = spyOn(spawnModule, "spawnWithWindowsHide").mockReturnValue(fakeProcess(0))

    // when
    const result = await runTuiInstaller({ tui: true, platform: "native" }, "5.0.0-beta.89")

    // then
    expect(result).toBe(0)
    expect(setupQuestionsAsked(confirmSpy)).toBe(0)
    expect(spawnSpy).not.toHaveBeenCalled()
  })
})

describe("runCliInstaller keeps the printed next step", () => {
  const mockConsoleLog = mock(() => {})
  const originalConsoleLog = console.log

  beforeEach(() => {
    console.log = mockConsoleLog
    mockConsoleLog.mockClear()
  })

  afterEach(() => {
    console.log = originalConsoleLog
    mock.restore()
  })

  it("#given --no-tui and a verified install #when it finishes #then omo setup is printed, not run", async () => {
    // given
    spyOn(installNative, "runNativeInstall").mockResolvedValue(outcome(true))
    const spawnSpy = spyOn(spawnModule, "spawnWithWindowsHide").mockReturnValue(fakeProcess(0))

    // when
    const result = await runCliInstaller({ tui: false, platform: "native" }, "5.0.0-beta.89")

    // then
    expect(result).toBe(0)
    expect(spawnSpy).not.toHaveBeenCalled()
    const printed = mockConsoleLog.mock.calls.map((call: unknown[]) => call.join(" ")).join("\n")
    expect(printed).toContain(installNative.nativeInstallSuccessLine(true))
  })
})
