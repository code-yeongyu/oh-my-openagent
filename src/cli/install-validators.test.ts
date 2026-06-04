/// <reference types="bun-types" />

import { describe, expect, test } from "bun:test"

import { argsToConfig, formatConfigSummary, validateNonTuiArgs } from "./install-validators"
import type { InstallArgs } from "./types"

function createArgs(overrides: Partial<InstallArgs> = {}): InstallArgs {
  return {
    tui: false,
    claude: "no",
    openai: "no",
    gemini: "no",
    copilot: "no",
    opencodeZen: "no",
    zaiCodingPlan: "no",
    kimiForCoding: "no",
    opencodeGo: "no",
    bailianCodingPlan: "no",
    minimaxCnCodingPlan: "no",
    minimaxCodingPlan: "no",
    vercelAiGateway: "no",
    skipAuth: false,
    ...overrides,
  }
}

describe("argsToConfig", () => {
  test("enables only OpenCode when platform is opencode", () => {
    // #given
    const args = createArgs({ platform: "opencode" })

    // #when
    const config = argsToConfig(args)

    // #then
    expect(config.platform).toBe("opencode")
    expect(config.hasOpenCode).toBe(true)
    expect(config.hasCodex).toBe(false)
  })

  test("enables Codex autonomous mode by default when platform is codex", () => {
    // #given
    const args = createArgs({ platform: "codex" })

    // #when
    const config = argsToConfig(args)

    // #then
    expect(config.platform).toBe("codex")
    expect(config.hasOpenCode).toBe(false)
    expect(config.hasCodex).toBe(true)
    expect(config.codexAutonomous).toBe(true)
  })

  test("leaves Codex permission settings unchanged when explicitly disabled", () => {
    // #given
    const args = createArgs({ platform: "codex", codexAutonomous: false })

    // #when
    const config = argsToConfig(args)

    // #then
    expect(config.hasCodex).toBe(true)
    expect(config.codexAutonomous).toBe(false)
  })

  test("ignores Codex autonomous mode when Codex is not installed", () => {
    // #given
    const args = createArgs({ platform: "opencode", codexAutonomous: true })

    // #when
    const config = argsToConfig(args)

    // #then
    expect(config.hasCodex).toBe(false)
    expect(config.codexAutonomous).toBe(false)
  })

  test("enables both harnesses when platform is both", () => {
    // #given
    const args = createArgs({ platform: "both" })

    // #when
    const config = argsToConfig(args)

    // #then
    expect(config.platform).toBe("both")
    expect(config.hasOpenCode).toBe(true)
    expect(config.hasCodex).toBe(true)
  })

  test("defaults to OpenCode when platform is omitted", () => {
    // #given
    const args = createArgs()

    // #when
    const config = argsToConfig(args)

    // #then
    expect(config.platform).toBe("opencode")
    expect(config.hasOpenCode).toBe(true)
    expect(config.hasCodex).toBe(false)
  })

  test("enables MiniMax Coding Plan providers for OpenCode installs", () => {
    // #given
    const args = createArgs({ minimaxCnCodingPlan: "yes", minimaxCodingPlan: "yes" })

    // #when
    const config = argsToConfig(args)

    // #then
    expect(config.hasMinimaxCnCodingPlan).toBe(true)
    expect(config.hasMinimaxCodingPlan).toBe(true)
  })

  test("enables Bailian Coding Plan for OpenCode installs", () => {
    // #given
    const args = createArgs({ bailianCodingPlan: "yes" })

    // #when
    const config = argsToConfig(args)

    // #then
    expect(config.hasBailianCodingPlan).toBe(true)
  })
})

describe("validateNonTuiArgs", () => {
  test("rejects invalid --opencode-go values", () => {
    // #given
    const args = createArgs({ opencodeGo: "maybe" as InstallArgs["opencodeGo"] })

    // #when
    const result = validateNonTuiArgs(args)

    // #then
    expect(result.valid).toBe(false)
    expect(result.errors).toContain("Invalid --opencode-go value: maybe (expected: no, yes)")
  })

  test("rejects invalid MiniMax Coding Plan values", () => {
    // #given
    const args = createArgs({
      minimaxCnCodingPlan: "maybe" as InstallArgs["minimaxCnCodingPlan"],
      minimaxCodingPlan: "sometimes" as InstallArgs["minimaxCodingPlan"],
    })

    // #when
    const result = validateNonTuiArgs(args)

    // #then
    expect(result.valid).toBe(false)
    expect(result.errors).toContain("Invalid --minimax-cn-coding-plan value: maybe (expected: no, yes)")
    expect(result.errors).toContain("Invalid --minimax-coding-plan value: sometimes (expected: no, yes)")
  })

  test("rejects invalid --bailian-coding-plan values", () => {
    // #given
    const args = createArgs({ bailianCodingPlan: "maybe" as InstallArgs["bailianCodingPlan"] })

    // #when
    const result = validateNonTuiArgs(args)

    // #then
    expect(result.valid).toBe(false)
    expect(result.errors).toContain("Invalid --bailian-coding-plan value: maybe (expected: no, yes)")
  })

  test("requires OpenCode provider flags when platform is opencode", () => {
    // #given
    const args = createArgs({ platform: "opencode", claude: undefined, gemini: undefined, copilot: undefined })

    // #when
    const result = validateNonTuiArgs(args)

    // #then
    expect(result.valid).toBe(false)
    expect(result.errors).toContain("--claude is required (values: no, yes, max20)")
    expect(result.errors).toContain("--gemini is required (values: no, yes)")
    expect(result.errors).toContain("--copilot is required (values: no, yes)")
  })

  test("requires OpenCode provider flags when platform is both", () => {
    // #given
    const args = createArgs({ platform: "both", claude: undefined, gemini: undefined, copilot: undefined })

    // #when
    const result = validateNonTuiArgs(args)

    // #then
    expect(result.valid).toBe(false)
    expect(result.errors).toContain("--claude is required (values: no, yes, max20)")
    expect(result.errors).toContain("--gemini is required (values: no, yes)")
    expect(result.errors).toContain("--copilot is required (values: no, yes)")
  })

  test("allows codex-only non-TUI installs", () => {
    // #given
    const args: InstallArgs = { tui: false, platform: "codex" }

    // #when
    const result = validateNonTuiArgs(args)

    // #then
    expect(result.valid).toBe(true)
    expect(result.errors).toEqual([])
  })

  test("allows platform=both without a LazyCodex publish flag", () => {
    // #given
    const args = createArgs({ platform: "both" })

    // #when
    const result = validateNonTuiArgs(args)

    // #then
    expect(result.valid).toBe(true)
    expect(result.errors).toEqual([])
  })

  test("rejects OpenCode flags for codex-only non-TUI installs", () => {
    // #given
    const args = createArgs({ platform: "codex", claude: "yes" })

    // #when
    const result = validateNonTuiArgs(args)

    // #then
    expect(result.valid).toBe(false)
    expect(result.errors).toContain("--claude cannot be used with --platform=codex")
  })

  test("rejects MiniMax Coding Plan flags for codex-only non-TUI installs", () => {
    // #given
    const args = createArgs({ platform: "codex", minimaxCodingPlan: "yes" })

    // #when
    const result = validateNonTuiArgs(args)

    // #then
    expect(result.valid).toBe(false)
    expect(result.errors).toContain("--minimax-coding-plan cannot be used with --platform=codex")
  })

  test("rejects Bailian Coding Plan flag for codex-only non-TUI installs", () => {
    // #given
    const args = createArgs({ platform: "codex", bailianCodingPlan: "yes" })

    // #when
    const result = validateNonTuiArgs(args)

    // #then
    expect(result.valid).toBe(false)
    expect(result.errors).toContain("--bailian-coding-plan cannot be used with --platform=codex")
  })
})

describe("formatConfigSummary", () => {
  test("shows platform instead of a separate Codex Harness provider line", () => {
    // #given
    const config = argsToConfig(createArgs({ platform: "both" }))

    // #when
    const summary = formatConfigSummary(config)

    // #then
    expect(summary).toContain("Platform: both")
    expect(summary).not.toContain("Codex Harness")
  })

  test("describes ZAI as fallback-only in the OpenCode summary", () => {
    // #given
    const config = argsToConfig(createArgs({ platform: "opencode", zaiCodingPlan: "yes" }))

    // #when
    const summary = formatConfigSummary(config)

    // #then
    expect(summary).toContain("Z.ai Coding Plan")
    expect(summary).toContain("GLM fallbacks")
    expect(summary).not.toContain("Librarian/Multimodal")
  })

  test("describes MiniMax Coding Plan as MiniMax-M3 fallback", () => {
    // #given
    const config = argsToConfig(createArgs({ platform: "opencode", minimaxCodingPlan: "yes" }))

    // #when
    const summary = formatConfigSummary(config)

    // #then
    expect(summary).toContain("MiniMax Coding Plan (minimax.io)")
    expect(summary).toContain("MiniMax-M3 fallback")
  })

  test("hides OpenCode model catalog for codex-only installs", () => {
    // #given
    const config = argsToConfig(createArgs({ platform: "codex", codexAutonomous: true }))

    // #when
    const summary = formatConfigSummary(config)

    // #then
    expect(summary).toContain("Platform: codex")
    expect(summary).toContain("Codex autonomous mode: enabled")
    expect(summary).not.toContain("Claude")
    expect(summary).not.toContain("OpenAI/ChatGPT")
    expect(summary).not.toContain("Model Assignment")
    expect(summary).not.toContain("Models auto-configured")
  })
})
