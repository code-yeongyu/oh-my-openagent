/// <reference types="bun-types" />

import { afterEach, describe, expect, test } from "bun:test"
import process from "node:process"
import { resolveInstallArgs } from "../cli-program"
import { argsToConfig } from "../install-validators"

describe("lazycodex install routing", () => {
  const originalInvocationName = process.env.OMO_INVOCATION_NAME
  const originalPublishLazycodex = process.env.OMO_PUBLISH_LAZYCODEX

  afterEach(() => {
    if (originalInvocationName === undefined) {
      delete process.env.OMO_INVOCATION_NAME
    } else {
      process.env.OMO_INVOCATION_NAME = originalInvocationName
    }

    if (originalPublishLazycodex === undefined) {
      delete process.env.OMO_PUBLISH_LAZYCODEX
    } else {
      process.env.OMO_PUBLISH_LAZYCODEX = originalPublishLazycodex
    }
  })

  test("leaves lazycodex invocation unresolved when lazycodex publishing is disabled", () => {
    // given
    process.env.OMO_INVOCATION_NAME = "lazycodex"
    delete process.env.OMO_PUBLISH_LAZYCODEX

    // when
    const args = resolveInstallArgs({
      tui: false,
      claude: "no",
      gemini: "no",
      copilot: "no",
    })
    const config = argsToConfig(args)

    // then
    expect(args.platform).toBeUndefined()
    expect(config.hasCodex).toBe(false)
    expect(config.hasOpenCode).toBe(true)
  })

  test("defaults platform to codex when invoked as lazycodex with lazycodex publishing enabled", () => {
    // given
    process.env.OMO_INVOCATION_NAME = "lazycodex"
    process.env.OMO_PUBLISH_LAZYCODEX = "true"

    // when
    const args = resolveInstallArgs({
      tui: false,
      claude: "no",
      gemini: "no",
      copilot: "no",
    })
    const config = argsToConfig(args)

    // then
    expect(args.platform).toBe("codex")
    expect(config.hasCodex).toBe(true)
    expect(config.hasOpenCode).toBe(false)
  })

  test("respects explicit --platform=both when lazycodex publishing is enabled", () => {
    // given
    process.env.OMO_INVOCATION_NAME = "lazycodex"
    process.env.OMO_PUBLISH_LAZYCODEX = "true"

    // when
    const args = resolveInstallArgs({
      tui: false,
      claude: "no",
      gemini: "no",
      copilot: "no",
      platform: "both",
    })
    const config = argsToConfig(args)

    // then
    expect(args.platform).toBe("both")
    expect(config.hasCodex).toBe(true)
    expect(config.hasOpenCode).toBe(true)
  })

  test("leaves omo install unresolved so argsToConfig applies opencode default", () => {
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
    expect(args.platform).toBeUndefined()
    expect(config.hasCodex).toBe(false)
    expect(config.hasOpenCode).toBe(true)
  })

  test("leaves unset invocation unresolved so argsToConfig applies opencode default", () => {
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
    expect(args.platform).toBeUndefined()
    expect(config.hasCodex).toBe(false)
    expect(config.hasOpenCode).toBe(true)
  })
})
