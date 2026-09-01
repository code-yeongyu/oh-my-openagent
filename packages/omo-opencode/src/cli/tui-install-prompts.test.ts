/// <reference types="bun-types" />

import { afterEach, beforeEach, describe, expect, mock, spyOn, test } from "bun:test"
import * as p from "@clack/prompts"
import { ULTIMATE_FALLBACK } from "./model-fallback"
import * as prompts from "./tui-install-prompts"
import type { DetectedConfig, InstallConfig, InstallPlatform } from "./types"

function createDetectedConfig(): DetectedConfig {
  return {
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
  }
}

function withTty(): () => void {
  const originalIsStdinTty = process.stdin.isTTY
  const originalIsStdoutTty = process.stdout.isTTY
  Object.defineProperty(process.stdin, "isTTY", { configurable: true, value: true })
  Object.defineProperty(process.stdout, "isTTY", { configurable: true, value: true })
  return () => {
    Object.defineProperty(process.stdin, "isTTY", { configurable: true, value: originalIsStdinTty })
    Object.defineProperty(process.stdout, "isTTY", { configurable: true, value: originalIsStdoutTty })
  }
}

describe("promptInstallPlatform", () => {
  let restoreTty: () => void

  beforeEach(() => {
    restoreTty = withTty()
  })

  afterEach(() => {
    restoreTty()
    mock.restore()
  })

  test("offers OpenCode, Codex, and Both choices while the senpi platform flag is disabled", async () => {
    // given
    delete process.env.OMO_ENABLE_SENPI_PLATFORM
    const selectSpy = spyOn(p, "select").mockResolvedValue("opencode")

    // when
    const value = await prompts.promptInstallPlatform("opencode")

    // then
    expect(value).toBe("opencode")
    expect(selectSpy).toHaveBeenCalledTimes(1)
    expect(selectSpy.mock.calls[0]?.[0]).toMatchObject({
      initialValue: "opencode",
      options: [
        { value: "opencode" },
        { value: "codex" },
        { value: "both" },
      ],
    })
  })

  test("offers the Senpi choice when the senpi platform flag is enabled", async () => {
    // given
    process.env.OMO_ENABLE_SENPI_PLATFORM = "1"
    const selectSpy = spyOn(p, "select").mockResolvedValue("senpi")

    try {
      // when
      const value = await prompts.promptInstallPlatform("opencode")

      // then
      expect(value).toBe("senpi")
      expect(selectSpy).toHaveBeenCalledTimes(1)
      expect(selectSpy.mock.calls[0]?.[0]).toMatchObject({
        initialValue: "opencode",
        options: [
          { value: "opencode" },
          { value: "codex" },
          { value: "both" },
          { value: "senpi" },
        ],
      })
    } finally {
      delete process.env.OMO_ENABLE_SENPI_PLATFORM
    }
  })

  test("preserves Codex as the initial platform", async () => {
    // given
    delete process.env.OMO_ENABLE_SENPI_PLATFORM
    const selectSpy = spyOn(p, "select").mockResolvedValue("codex")

    // when
    const value = await prompts.promptInstallPlatform("codex")

    // then
    expect(value).toBe("codex")
    expect(selectSpy).toHaveBeenCalledTimes(1)
    expect(selectSpy.mock.calls[0]?.[0]).toMatchObject({
      initialValue: "codex",
      options: [
        { value: "opencode" },
        { value: "codex" },
        { value: "both" },
      ],
    })
  })
})

describe("promptInstallConfig platform branching", () => {
  let restoreTty: () => void

  beforeEach(() => {
    restoreTty = withTty()
  })

  afterEach(() => {
    restoreTty()
    mock.restore()
  })

  test("skips OpenCode questions when the user selects codex", async () => {
    // given
    const selectSpy = spyOn(p, "select").mockResolvedValue("no")

    // when
    const config = await prompts.promptInstallConfig(createDetectedConfig(), "codex")

    // then
    expect(config).toMatchObject({
      platform: "codex",
      hasOpenCode: false,
      hasCodex: true,
      codexAutonomous: true,
    } satisfies Partial<InstallConfig>)
    expect(selectSpy).not.toHaveBeenCalled()
  })

  test("skips OpenCode questions when the user selects senpi", async () => {
    // given
    const selectSpy = spyOn(p, "select").mockResolvedValue("no")

    // when
    const config = await prompts.promptInstallConfig(createDetectedConfig(), "senpi")

    // then
    expect(config).toMatchObject({
      platform: "senpi",
      hasOpenCode: false,
      hasCodex: false,
      hasSenpi: true,
    } satisfies Partial<InstallConfig>)
    expect(selectSpy).not.toHaveBeenCalled()
  })

  test.each([
    ["opencode", false],
    ["both", true],
  ] satisfies readonly [InstallPlatform, boolean][])(
    "asks OpenCode questions when the user selects %s",
    async (platform, hasCodex) => {
      // given
      const selectSpy = spyOn(p, "select").mockResolvedValue("no")

      // when
      const config = await prompts.promptInstallConfig(createDetectedConfig(), platform)

      // then
      expect(config).toMatchObject({ platform, hasOpenCode: true, hasCodex } satisfies Partial<InstallConfig>)
      expect(selectSpy).toHaveBeenCalledTimes(12)
    },
  )

  test("Claude subscription No option hint uses ultimate fallback", async () => {
    // given
    const selectSpy = spyOn(p, "select").mockResolvedValue("no")

    // when
    await prompts.promptInstallConfig(createDetectedConfig(), "opencode")

    // then
    const firstCall = selectSpy.mock.calls[0]?.[0]
    expect(firstCall?.message).toBe("Do you have a Claude Pro/Max subscription?")
    const options = firstCall?.options as Array<{ value: string; hint?: string }>
    const noOption = options?.find((o) => o.value === "no")
    expect(noOption?.hint).toContain(ULTIMATE_FALLBACK)
    expect(noOption?.hint).not.toContain("big-pickle")
  })

  test("uses explicit Codex autonomous override without asking", async () => {
    // given
    const selectSpy = spyOn(p, "select").mockResolvedValue("no")

    // when
    const config = await prompts.promptInstallConfig(createDetectedConfig(), "codex", false)

    // then
    expect(config).toMatchObject({
      platform: "codex",
      hasCodex: true,
      codexAutonomous: false,
    } satisfies Partial<InstallConfig>)
    expect(selectSpy).not.toHaveBeenCalled()
  })

  test("does not ask the old Codex adapter question", async () => {
    // given
    const selectSpy = spyOn(p, "select").mockResolvedValue("no")

    // when
    await prompts.promptInstallConfig(createDetectedConfig(), "both")

    // then
    const messages = selectSpy.mock.calls.map((call) => call[0].message)
    expect(messages).not.toContain("Install Codex harness adapter into ~/.codex?")
  })
})
