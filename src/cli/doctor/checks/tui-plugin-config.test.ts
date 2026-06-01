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

function writeInstalledPackage(
  configDir: string,
  packageName: string,
  exportsField: Record<string, unknown> | null,
): void {
  const pkgDir = join(configDir, "node_modules", packageName)
  mkdirSync(pkgDir, { recursive: true })
  const packageJson: Record<string, unknown> = { name: packageName, version: "4.5.12" }
  if (exportsField !== null) packageJson["exports"] = exportsField
  writeFileSync(join(pkgDir, "package.json"), JSON.stringify(packageJson, null, 2) + "\n", "utf-8")
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

  it("warns when tui.json has our entry but server plugin is missing from opencode.json", async () => {
    //#given tui.json has the TUI entry but opencode.json does not have the server entry
    writeOpenCodeConfig(["some-other-plugin"])
    writeTuiConfig([`${PLUGIN_NAME}/tui`])

    //#when running the check
    const result = await checkTuiPluginConfig()

    //#then status is warn — TUI-only registration can't function without the server side
    expect(result.status).toBe("warn")
    expect(result.issues).toHaveLength(1)
    expect(result.issues[0].severity).toBe("warning")
    expect(result.issues[0].title).toContain("Server plugin entry missing")
    expect(result.issues[0].fix).toBeDefined()
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

  it("does not warn about missing TUI entry when installed package has no ./tui export (fixes #4643)", async () => {
    //#given the server plugin is registered but the locally installed
    //#       package.json has no `./tui` export (matches the published 4.5.12 tarball).
    //#       Following the old `add "oh-my-openagent/tui" to tui.json` advice would
    //#       make OpenCode interpret it as a GitHub `owner/repo` and hang ~140s.
    writeOpenCodeConfig([PLUGIN_NAME])
    writeTuiConfig(["some-other-tui-plugin"])
    writeInstalledPackage(testConfigDir, "oh-my-opencode", {
      ".": { types: "./dist/index.d.ts", import: "./dist/index.js" },
      "./server": "./dist/index.js",
      "./schema.json": "./dist/oh-my-opencode.schema.json",
    })

    //#when running the check
    const result = await checkTuiPluginConfig()

    //#then status is pass — the package does not ship a TUI subpath, so no entry
    //#       should be recommended
    expect(result.status).toBe("pass")
    expect(result.issues).toHaveLength(0)
  })

  it("warns when tui.json already contains the unresolvable TUI entry (fixes #4643)", async () => {
    //#given the user previously followed the doctor's old recommendation and added
    //#       `oh-my-openagent/tui` to tui.json, but the installed package still
    //#       does not expose `./tui`. OpenCode hangs ~140s trying to git-clone the
    //#       non-existent `oh-my-openagent/tui` repository.
    writeOpenCodeConfig([PLUGIN_NAME])
    writeTuiConfig([PLUGIN_NAME, `${PLUGIN_NAME}/tui`])
    writeInstalledPackage(testConfigDir, "oh-my-opencode", {
      ".": { types: "./dist/index.d.ts", import: "./dist/index.js" },
      "./server": "./dist/index.js",
      "./schema.json": "./dist/oh-my-opencode.schema.json",
    })

    //#when running the check
    const result = await checkTuiPluginConfig()

    //#then status is warn — the entry would cause OpenCode to hang on plugin load
    expect(result.status).toBe("warn")
    expect(result.issues).toHaveLength(1)
    expect(result.issues[0].title).toContain("unresolvable")
    expect(result.issues[0].fix).toContain("Remove")
  })

  it("still warns about missing TUI entry when installed package exports ./tui", async () => {
    //#given a future package that does ship the `./tui` subpath export
    writeOpenCodeConfig([PLUGIN_NAME])
    writeTuiConfig(["some-other-tui-plugin"])
    writeInstalledPackage(testConfigDir, "oh-my-opencode", {
      ".": { types: "./dist/index.d.ts", import: "./dist/index.js" },
      "./server": "./dist/index.js",
      "./tui": "./dist/tui.js",
    })

    //#when running the check
    const result = await checkTuiPluginConfig()

    //#then existing warn behavior is preserved — the entry would actually work
    expect(result.status).toBe("warn")
    expect(result.issues).toHaveLength(1)
    expect(result.issues[0].title).toContain("TUI plugin entry missing")
  })
})
