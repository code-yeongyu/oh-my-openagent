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

  test("enables only Codex when platform is codex", () => {
    // #given
    const args = createArgs({ platform: "codex", codexAutonomous: true })

    // #when
    const config = argsToConfig(args)

    // #then
    expect(config.platform).toBe("codex")
    expect(config.hasOpenCode).toBe(false)
    expect(config.hasCodex).toBe(true)
    expect(config.codexAutonomous).toBe(true)
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
})
