/// <reference types="bun-types" />

import { afterEach, describe, expect, test } from "bun:test"
import process from "node:process"
import { resolveInstallArgs } from "../cli-program"
import { argsToConfig } from "../install-validators"

describe("lazycodex install routing", () => {
  const originalInvocationName = process.env.OMO_INVOCATION_NAME

  afterEach(() => {
    if (originalInvocationName === undefined) {
      delete process.env.OMO_INVOCATION_NAME
      return
    }
    process.env.OMO_INVOCATION_NAME = originalInvocationName
  })

  test("defaults codex to yes when invoked as lazycodex and user did not pass --codex", () => {
    // given
    process.env.OMO_INVOCATION_NAME = "lazycodex"

    // when
    const args = resolveInstallArgs({
      tui: false,
      claude: "no",
      gemini: "no",
      copilot: "no",
    })
    const config = argsToConfig(args)

    // then
    expect(args.codex).toBe("yes")
    expect(config.hasCodex).toBe(true)
  })

  test("respects explicit --codex=no when invoked as lazycodex", () => {
    // given
    process.env.OMO_INVOCATION_NAME = "lazycodex"

    // when
    const args = resolveInstallArgs({
      tui: false,
      claude: "no",
      gemini: "no",
      copilot: "no",
      codex: "no",
    })
    const config = argsToConfig(args)

    // then
    expect(args.codex).toBe("no")
    expect(config.hasCodex).toBe(false)
  })

  test("keeps codex disabled by default when invocation name is oh-my-opencode", () => {
    // given
    process.env.OMO_INVOCATION_NAME = "oh-my-opencode"

    // when
    const args = resolveInstallArgs({
      tui: false,
      claude: "no",
      gemini: "no",
      copilot: "no",
    })
    const config = argsToConfig(args)

    // then
    expect(args.codex).toBeUndefined()
    expect(config.hasCodex).toBe(false)
  })

  test("keeps codex disabled by default when invocation name is unset", () => {
    // given
    delete process.env.OMO_INVOCATION_NAME

    // when
    const args = resolveInstallArgs(
      {
        tui: false,
        claude: "no",
        gemini: "no",
        copilot: "no",
      },
      undefined,
    )
    const config = argsToConfig(args)

    // then
    expect(args.codex).toBeUndefined()
    expect(config.hasCodex).toBe(false)
  })
})
