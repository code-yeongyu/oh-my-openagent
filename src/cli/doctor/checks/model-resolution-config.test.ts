import { afterEach, beforeEach, describe, expect, it } from "bun:test"
import { mkdirSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { loadOmoConfig } from "./model-resolution-config"

describe("model-resolution-config", () => {
  let originalConfigDir: string | undefined

  beforeEach(() => {
    originalConfigDir = process.env.OPENCODE_CONFIG_DIR
  })

  afterEach(() => {
    if (originalConfigDir === undefined) {
      delete process.env.OPENCODE_CONFIG_DIR
    } else {
      process.env.OPENCODE_CONFIG_DIR = originalConfigDir
    }
  })

  it("respects OPENCODE_CONFIG_DIR even when the env var changes after module import", () => {
    const testConfigDir = join(
      tmpdir(),
      `omo-model-resolution-config-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    )

    try {
      mkdirSync(testConfigDir, { recursive: true })
      process.env.OPENCODE_CONFIG_DIR = testConfigDir
      writeFileSync(
        join(testConfigDir, "oh-my-openagent.json"),
        JSON.stringify({ agents: { atlas: { model: "opencode-go/kimi-k2.5" } } }, null, 2) + "\n",
        "utf-8",
      )

      const config = loadOmoConfig()

      expect(config?.agents?.atlas?.model).toBe("opencode-go/kimi-k2.5")
    } finally {
      rmSync(testConfigDir, { recursive: true, force: true })
    }
  })
})
