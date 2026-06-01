/// <reference path="../../bun-test.d.ts" />
/// <reference types="bun-types" />

import { afterEach, beforeEach, describe, expect, it, spyOn } from "bun:test"
import * as p from "@clack/prompts"
import * as codexInstaller from "./install-codex"
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

describe("runTuiInstaller Codex cleanup", () => {
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

  it("passes a friendly OMX cleanup confirmation into the Codex installer", async () => {
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
        hasVercelAiGateway: false,
        codexAutonomous: false,
      }),
    ]
    const codexSpy = spyOn(codexInstaller, "runCodexInstaller").mockResolvedValue({
      marketplaceName: "sisyphuslabs",
      installed: [],
      configPath: "/tmp/codex-config.toml",
      codexHome: "/tmp/codex-home",
      gitBashPath: null,
    })

    // when
    const result = await runTuiInstaller({ tui: true, platform: "codex" }, "3.16.0")
    const options = codexSpy.mock.calls[0]?.[0]
    const approved = await options?.confirmOhMyCodexCleanup?.({ omxPath: "/tmp/bin/omx" })

    // then
    expect(result).toBe(0)
    expect(approved).toBe(true)
    expect(p.confirm).toHaveBeenCalledWith({
      message: "Remove the old OMX install and continue?",
      initialValue: true,
    })

    for (const spy of restoreSpies) {
      spy.mockRestore()
    }
    codexSpy.mockRestore()
  })
})
