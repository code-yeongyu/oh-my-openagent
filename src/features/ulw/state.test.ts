import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { isUlwEnabled, setUlwEnabled, _resetUlwForTesting } from "./state"

describe("ULW state", () => {
  const originalXdg = process.env.XDG_CONFIG_HOME

  beforeEach(() => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "omo-ulw-"))
    process.env.XDG_CONFIG_HOME = tmp
    _resetUlwForTesting()
  })

  afterEach(() => {
    process.env.XDG_CONFIG_HOME = originalXdg
  })

  test("setUlwEnabled persists and isUlwEnabled reflects it", () => {
    // #given
    expect(isUlwEnabled()).toBe(false)

    // #when
    setUlwEnabled(true)

    // #then
    expect(isUlwEnabled()).toBe(true)

    // Ensure it persists to disk (best-effort).
    const cfgDir = process.env.XDG_CONFIG_HOME!
    const statePath = path.join(cfgDir, "opencode", "oh-my-opencode", "ulw.state.json")
    expect(fs.existsSync(statePath)).toBe(true)
    const parsed = JSON.parse(fs.readFileSync(statePath, "utf8")) as { enabled?: unknown }
    expect(parsed.enabled).toBe(true)
  })
})

