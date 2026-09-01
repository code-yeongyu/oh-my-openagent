/// <reference types="bun-types" />

import { describe, expect, test } from "bun:test"
import { availableInstallPlatforms, isSenpiPlatformEnabled, SENPI_PLATFORM_ENV_FLAG } from "./senpi-platform-flag"

describe("isSenpiPlatformEnabled", () => {
  test("#given no flag value #when checked #then senpi platform is disabled", () => {
    // given
    const env = {} satisfies NodeJS.ProcessEnv

    // when / then
    expect(isSenpiPlatformEnabled(env)).toBe(false)
  })

  test.each([
    ["1", true],
    ["true", true],
    [" TRUE ", true],
    ["0", false],
    ["", false],
    ["yes", false],
    ["false", false],
  ])("#given flag value %p #when checked #then enabled is %p", (value, expected) => {
    // given
    const env = { [SENPI_PLATFORM_ENV_FLAG]: value } satisfies NodeJS.ProcessEnv

    // when / then
    expect(isSenpiPlatformEnabled(env)).toBe(expected)
  })
})

describe("availableInstallPlatforms", () => {
  test("#given flag disabled #when platforms are listed #then senpi is absent", () => {
    // given
    const env = {} satisfies NodeJS.ProcessEnv

    // when
    const platforms = availableInstallPlatforms(env)

    // then
    expect(platforms).toEqual(["opencode", "codex", "both"])
  })

  test("#given flag enabled #when platforms are listed #then senpi is offered last", () => {
    // given
    const env = { [SENPI_PLATFORM_ENV_FLAG]: "1" } satisfies NodeJS.ProcessEnv

    // when
    const platforms = availableInstallPlatforms(env)

    // then
    expect(platforms).toEqual(["opencode", "codex", "both", "senpi"])
  })
})
