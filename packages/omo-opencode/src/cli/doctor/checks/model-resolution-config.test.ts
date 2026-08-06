import { afterEach, beforeEach, describe, expect, it } from "bun:test"
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { loadOmoConfig } from "./model-resolution-config"

describe("model-resolution-config", () => {
  let originalHome: string | undefined
  let temporaryDirectory = ""

  beforeEach(() => {
    originalHome = process.env.HOME
    temporaryDirectory = mkdtempSync(join(tmpdir(), "omo-model-resolution-config-"))
    process.env.HOME = temporaryDirectory
  })

  afterEach(() => {
    rmSync(temporaryDirectory, { recursive: true, force: true })
    if (originalHome === undefined) delete process.env.HOME
    else process.env.HOME = originalHome
  })

  it("#given a user omo config #when loading model settings #then reads its opencode view", () => {
    const path = join(temporaryDirectory, ".omo", "omo.jsonc")
    mkdirSync(join(path, ".."), { recursive: true })
    writeFileSync(path, JSON.stringify({
      "[opencode]": { agents: { atlas: { model: "opencode-go/kimi-k2.6" } } },
    }) + "\n")

    expect(loadOmoConfig().agents?.atlas?.model).toBe("opencode-go/kimi-k2.6")
  })
})
