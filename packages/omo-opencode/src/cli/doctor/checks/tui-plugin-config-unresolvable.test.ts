import { afterEach, beforeEach, describe, expect, it } from "bun:test"
import { mkdirSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { PLUGIN_NAME } from "../../../shared"
import { checkTuiPluginConfig } from "./tui-plugin-config"

let testConfigDir: string
let originalConfigDir: string | undefined

function writeOpenCodeConfig(plugins: readonly string[]): void {
  writeFileSync(
    join(testConfigDir, "opencode.json"),
    JSON.stringify({ plugin: plugins }, null, 2) + "\n",
    "utf-8",
  )
}

function writeTuiConfig(plugins: readonly string[]): void {
  writeFileSync(
    join(testConfigDir, "tui.json"),
    JSON.stringify({ plugin: plugins }, null, 2) + "\n",
    "utf-8",
  )
}

describe("tui-plugin-config unresolvable named entries", () => {
  beforeEach(() => {
    originalConfigDir = process.env.OPENCODE_CONFIG_DIR
    testConfigDir = join(
      tmpdir(),
      `omo-doctor-tui-unresolvable-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    )
    mkdirSync(testConfigDir, { recursive: true })
    process.env.OPENCODE_CONFIG_DIR = testConfigDir
  })

  afterEach(() => {
    rmSync(testConfigDir, { recursive: true, force: true })
    if (originalConfigDir === undefined) {
      delete process.env.OPENCODE_CONFIG_DIR
    } else {
      process.env.OPENCODE_CONFIG_DIR = originalConfigDir
    }
  })

  it("#given canonical TUI entry and no inspectable package #when checking config #then warns instead of false-passing", async () => {
    // given
    writeOpenCodeConfig([PLUGIN_NAME])
    writeTuiConfig([`${PLUGIN_NAME}/tui`])

    // when
    const result = await checkTuiPluginConfig()

    // then
    expect(result.status).toBe("warn")
    expect(result.message).toBe("TUI plugin entry in tui.json is unresolvable")
    expect(result.issues[0]?.description).toContain("could not be inspected")
  })
})
