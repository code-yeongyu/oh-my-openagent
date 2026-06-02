import { afterEach, beforeEach, describe, expect, test } from "bun:test"

import { getOpenCodeConfigDir } from "./opencode-config-dir"

describe("opencode-config-dir WSL handling", () => {
  let originalPlatform: NodeJS.Platform
  let originalEnv: Record<string, string | undefined>

  beforeEach(() => {
    originalPlatform = process.platform
    originalEnv = {
      HOME: process.env.HOME,
      LOGNAME: process.env.LOGNAME,
      OPENCODE_CONFIG_DIR: process.env.OPENCODE_CONFIG_DIR,
      SUDO_USER: process.env.SUDO_USER,
      USER: process.env.USER,
      WSL_DISTRO_NAME: process.env.WSL_DISTRO_NAME,
      WSL_INTEROP: process.env.WSL_INTEROP,
      XDG_CONFIG_HOME: process.env.XDG_CONFIG_HOME,
    }
  })

  afterEach(() => {
    Object.defineProperty(process, "platform", { value: originalPlatform })
    for (const [key, value] of Object.entries(originalEnv)) {
      if (value === undefined) {
        delete process.env[key]
      } else {
        process.env[key] = value
      }
    }
  })

  test("#given WSL leaks Windows HOME and USER is missing #when resolving CLI config #then Linux home preserves the inferred XDG user", () => {
    // given
    Object.defineProperty(process, "platform", { value: "linux" })
    process.env.WSL_DISTRO_NAME = "Ubuntu"
    process.env.HOME = "C:\\Users\\Hanbin"
    process.env.XDG_CONFIG_HOME = "C:\\Users\\Hanbin\\.config"
    delete process.env.OPENCODE_CONFIG_DIR
    delete process.env.USER
    delete process.env.LOGNAME
    delete process.env.SUDO_USER

    // when
    const result = getOpenCodeConfigDir({ binary: "opencode", version: "1.14.48" })

    // then
    expect(result).toBe("/home/Hanbin/.config/opencode")
  })

  test("#given WSL leaks a Windows config root through XDG_CONFIG_HOME #when resolving CLI config #then Linux HOME is used", () => {
    // given
    Object.defineProperty(process, "platform", { value: "linux" })
    process.env.WSL_DISTRO_NAME = "Ubuntu"
    process.env.HOME = "/home/hanbin"
    process.env.XDG_CONFIG_HOME = "C:\\Users\\Hanbin\\.config"
    delete process.env.OPENCODE_CONFIG_DIR

    // when
    const result = getOpenCodeConfigDir({ binary: "opencode", version: "1.14.48" })

    // then
    expect(result).toBe("/home/hanbin/.config/opencode")
  })

  test("#given WSL leaks a mounted Windows user config root #when resolving CLI config #then Linux HOME is used", () => {
    // given
    Object.defineProperty(process, "platform", { value: "linux" })
    process.env.WSL_DISTRO_NAME = "Ubuntu"
    process.env.HOME = "/home/hanbin"
    process.env.XDG_CONFIG_HOME = "/mnt/c/Users/Hanbin/.config"
    delete process.env.OPENCODE_CONFIG_DIR

    // when
    const result = getOpenCodeConfigDir({ binary: "opencode", version: "1.14.48" })

    // then
    expect(result).toBe("/home/hanbin/.config/opencode")
  })

  test("#given WSL has an explicit OPENCODE_CONFIG_DIR #when resolving CLI config #then the explicit override wins", () => {
    // given
    Object.defineProperty(process, "platform", { value: "linux" })
    process.env.WSL_DISTRO_NAME = "Ubuntu"
    process.env.HOME = "/home/hanbin"
    process.env.XDG_CONFIG_HOME = "C:\\Users\\Hanbin\\.config"
    process.env.OPENCODE_CONFIG_DIR = "/tmp/opencode-profile"

    // when
    const result = getOpenCodeConfigDir({ binary: "opencode", version: "1.14.48" })

    // then
    expect(result).toBe("/tmp/opencode-profile")
  })
})
