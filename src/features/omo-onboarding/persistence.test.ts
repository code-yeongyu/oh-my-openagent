import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { loadPersistedOmoOnboardingShown, persistOmoOnboardingShown } from "./persistence"

describe("omo onboarding persistence", () => {
  let originalXdg: string | undefined
  let hadOriginalXdg = false

  beforeEach(() => {
    hadOriginalXdg = Object.prototype.hasOwnProperty.call(process.env, "XDG_CONFIG_HOME")
    originalXdg = process.env.XDG_CONFIG_HOME
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "omo-onboarding-"))
    process.env.XDG_CONFIG_HOME = tmp
  })

  afterEach(() => {
    if (hadOriginalXdg) {
      process.env.XDG_CONFIG_HOME = originalXdg
    } else {
      delete process.env.XDG_CONFIG_HOME
    }
  })

  test("load returns false when no state file exists", () => {
    // #then
    expect(loadPersistedOmoOnboardingShown()).toBe(false)
  })

  test("persist then load returns true", () => {
    // #when
    persistOmoOnboardingShown(true)

    // #then
    expect(loadPersistedOmoOnboardingShown()).toBe(true)
  })
})
