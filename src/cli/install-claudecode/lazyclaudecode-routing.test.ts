/// <reference types="bun-types" />

import { afterEach, describe, expect, test } from "bun:test"
import process from "node:process"
import { resolveInstallArgs } from "../cli-program"
import { argsToConfig } from "../install-validators"

describe("lazyclaudecode install routing", () => {
  const originalInvocationName = process.env.OMO_INVOCATION_NAME

  afterEach(() => {
    if (originalInvocationName === undefined) {
      delete process.env.OMO_INVOCATION_NAME
      return
    }
    process.env.OMO_INVOCATION_NAME = originalInvocationName
  })

  test("defaults platform to claudecode when invoked as lazyclaudecode without --platform", () => {
    // given
    process.env.OMO_INVOCATION_NAME = "lazyclaudecode"

    // when
    const args = resolveInstallArgs({ tui: false })
    const config = argsToConfig(args)

    // then
    expect(args.platform).toBe("claudecode")
    expect(config.hasClaudeCode).toBe(true)
    expect(config.hasOpenCode).toBe(false)
    expect(config.hasCodex).toBe(false)
  })

  test("respects explicit --platform=opencode when invoked as lazyclaudecode", () => {
    // given
    process.env.OMO_INVOCATION_NAME = "lazyclaudecode"

    // when
    const args = resolveInstallArgs({
      tui: false,
      claude: "no",
      gemini: "no",
      copilot: "no",
      platform: "opencode",
    })
    const config = argsToConfig(args)

    // then
    expect(args.platform).toBe("opencode")
    expect(config.hasClaudeCode).toBe(false)
    expect(config.hasOpenCode).toBe(true)
  })

  test("does not resolve lazyclaudecode to codex or opencode by default", () => {
    // given
    process.env.OMO_INVOCATION_NAME = "lazyclaudecode"

    // when
    const args = resolveInstallArgs({ tui: false })

    // then
    expect(args.platform).not.toBe("codex")
    expect(args.platform).not.toBe("opencode")
    expect(args.platform).toBe("claudecode")
  })
})
