import { afterEach, beforeEach, describe, expect, it } from "bun:test"
import { mkdirSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { PLUGIN_NAME } from "../../../shared"
import { checkTuiPluginConfig } from "./tui-plugin-config"

let testConfigDir: string
let originalConfigDir: string | undefined

function writeOpenCodeConfig(plugins: string[]): void {
  writeFileSync(
    join(testConfigDir, "opencode.json"),
    JSON.stringify({ plugin: plugins }, null, 2) + "\n",
    "utf-8",
  )
}

function writeTuiConfig(plugins: string[]): void {
  writeFileSync(
    join(testConfigDir, "tui.json"),
    JSON.stringify({ plugin: plugins }, null, 2) + "\n",
    "utf-8",
  )
}

function writeFilePluginPackage(dir: string, packageName: string): string {
  mkdirSync(dir, { recursive: true })
  writeFileSync(
    join(dir, "package.json"),
    JSON.stringify({ name: packageName }, null, 2) + "\n",
    "utf-8",
  )
  return `file:${dir}`
}

describe("tui-plugin-config check", () => {
  beforeEach(() => {
    originalConfigDir = process.env.OPENCODE_CONFIG_DIR
    testConfigDir = join(
      tmpdir(),
      `omo-doctor-tui-${Date.now()}-${Math.random().toString(36).slice(2)}`,
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

  it("passes when both server and TUI entries are registered", async () => {
    //#given opencode.json has the server entry and tui.json has the TUI entry
    writeOpenCodeConfig([PLUGIN_NAME])
    writeTuiConfig([`${PLUGIN_NAME}/tui`])

    //#when running the check
    const result = await checkTuiPluginConfig()

    //#then both are detected and status is pass
    expect(result.status).toBe("pass")
    expect(result.issues).toHaveLength(0)
    expect(result.name).toBe("TUI Plugin")
  })

  it("warns when server is registered but TUI entry is missing", async () => {
    //#given opencode.json has the server entry but tui.json does not
    writeOpenCodeConfig([PLUGIN_NAME])
    writeTuiConfig(["some-other-tui-plugin"])

    //#when running the check
    const result = await checkTuiPluginConfig()

    //#then status is warn with a single warning issue
    expect(result.status).toBe("warn")
    expect(result.issues).toHaveLength(1)
    expect(result.issues[0].severity).toBe("warning")
    expect(result.issues[0].title).toContain("TUI plugin entry missing")
    expect(result.issues[0].fix).toBeDefined()
  })

  it("warns when server is registered but tui.json does not exist", async () => {
    //#given opencode.json has the server entry and tui.json is absent
    writeOpenCodeConfig([PLUGIN_NAME])

    //#when running the check
    const result = await checkTuiPluginConfig()

    //#then status is warn — missing file means missing entry
    expect(result.status).toBe("warn")
    expect(result.issues).toHaveLength(1)
    expect(result.issues[0].severity).toBe("warning")
  })

  it("passes when tui.json has a file: entry pointing at our package", async () => {
    //#given opencode.json has the server entry and tui.json uses a file: URL
    //#       pointing at a local checkout of our package
    writeOpenCodeConfig([PLUGIN_NAME])
    const localPkgDir = join(testConfigDir, "local-checkout")
    const fileEntry = writeFilePluginPackage(localPkgDir, "oh-my-opencode")
    writeTuiConfig([fileEntry])

    //#when running the check
    const result = await checkTuiPluginConfig()

    //#then file: entry satisfies registration and status is pass
    expect(result.status).toBe("pass")
    expect(result.issues).toHaveLength(0)
  })

  it("skips when neither config registers the plugin", async () => {
    //#given an opencode.json and tui.json with no oh-my-openagent entries
    writeOpenCodeConfig(["some-other-plugin"])
    writeTuiConfig(["some-other-tui-plugin"])

    //#when running the check
    const result = await checkTuiPluginConfig()

    //#then status is skip — plugin not installed at all
    expect(result.status).toBe("skip")
    expect(result.issues).toHaveLength(0)
    expect(result.message).toContain("not registered")
  })

  it("passes when legacy server entry is paired with legacy TUI entry", async () => {
    //#given legacy package names in both configs
    writeOpenCodeConfig(["oh-my-opencode"])
    writeTuiConfig(["oh-my-opencode/tui"])

    //#when running the check
    const result = await checkTuiPluginConfig()

    //#then legacy aliases are accepted
    expect(result.status).toBe("pass")
    expect(result.issues).toHaveLength(0)
  })
})
