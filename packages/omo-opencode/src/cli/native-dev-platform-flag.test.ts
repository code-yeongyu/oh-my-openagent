/// <reference types="bun-types" />

import { describe, expect, test } from "bun:test"
import {
  availableInstallPlatforms,
  isNativeDevPlatformEnabled,
  LEGACY_NATIVE_DEV_PLATFORM_ENV_FLAG,
  NATIVE_DEV_PLATFORM_ENV_FLAG,
} from "./native-dev-platform-flag"

describe("isNativeDevPlatformEnabled", () => {
  test("#given no flag value #when checked #then the native-dev platform is disabled", () => {
    // given
    const env = {} satisfies NodeJS.ProcessEnv

    // when / then
    expect(isNativeDevPlatformEnabled(env)).toBe(false)
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
    const env = { [NATIVE_DEV_PLATFORM_ENV_FLAG]: value } satisfies NodeJS.ProcessEnv

    // when / then
    expect(isNativeDevPlatformEnabled(env)).toBe(expected)
  })

  test("#given only the legacy flag #when checked #then it still enables the native-dev platform", () => {
    // given
    const env = { [LEGACY_NATIVE_DEV_PLATFORM_ENV_FLAG]: "1" } satisfies NodeJS.ProcessEnv

    // when / then
    expect(isNativeDevPlatformEnabled(env)).toBe(true)
  })
})

describe("availableInstallPlatforms", () => {
  test("#given no flag #when platforms are listed #then native is public and native-dev is absent", () => {
    // given
    const env = {} satisfies NodeJS.ProcessEnv

    // when
    const platforms = availableInstallPlatforms(env)

    // then
    expect(platforms).toEqual(["opencode", "codex", "both", "native"])
  })

  test("#given the flag enabled #when platforms are listed #then native-dev is offered last", () => {
    // given
    const env = { [NATIVE_DEV_PLATFORM_ENV_FLAG]: "1" } satisfies NodeJS.ProcessEnv

    // when
    const platforms = availableInstallPlatforms(env)

    // then
    expect(platforms).toEqual(["opencode", "codex", "both", "native", "native-dev"])
  })

  test("#given only the legacy flag #when platforms are listed #then native-dev is still offered", () => {
    // given
    const env = { [LEGACY_NATIVE_DEV_PLATFORM_ENV_FLAG]: "true" } satisfies NodeJS.ProcessEnv

    // when
    const platforms = availableInstallPlatforms(env)

    // then
    expect(platforms).toEqual(["opencode", "codex", "both", "native", "native-dev"])
  })
})
