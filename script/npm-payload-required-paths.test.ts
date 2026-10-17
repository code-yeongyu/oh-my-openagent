/// <reference types="bun-types" />

import { describe, expect, test } from "bun:test"
import { findMissingPayloadPaths, requiredCodexInstallPaths } from "./npm-payload-required-paths.mjs"

const canonicalCodexPromptPath = "packages/prompts-core/prompts/ultrawork/codex.md"

describe("npm payload required paths", () => {
  test("#given the Codex install requirements #when they are resolved #then the canonical prompt is required with posix separators", () => {
    // given / when
    const required = requiredCodexInstallPaths()

    // then
    expect(required).toContain(canonicalCodexPromptPath)
  })

  test("#given a payload without the canonical prompt #when it is checked #then the missing path is reported", () => {
    // given
    const packedPaths = ["package.json", "packages/shared-skills/index.mjs"]

    // when
    const missing = findMissingPayloadPaths(packedPaths, requiredCodexInstallPaths())

    // then
    expect(missing).toEqual([canonicalCodexPromptPath])
  })

  test("#given a payload carrying the canonical prompt #when it is checked #then nothing is reported", () => {
    // given
    const packedPaths = ["package.json", canonicalCodexPromptPath]

    // when
    const missing = findMissingPayloadPaths(packedPaths, requiredCodexInstallPaths())

    // then
    expect(missing).toEqual([])
  })
})
