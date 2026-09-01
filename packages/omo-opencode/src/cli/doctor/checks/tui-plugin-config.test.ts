import { afterEach, beforeEach, describe, expect, it } from "bun:test"
import { mkdirSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { PLUGIN_NAME } from "../../../shared"
import { ensureTuiPluginEntry } from "../../config-manager/add-tui-plugin-to-tui-config"
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

function writeTuiConfig(plugins: readonly unknown[]): void {
  writeFileSync(
    join(testConfigDir, "tui.json"),
    JSON.stringify({ plugin: plugins }, null, 2) + "\n",
    "utf-8",
  )
}

function createPackageJson(packageName: string, exportsValue: Record<string, unknown> = { ".": "./dist/index.js" }): string {
  return JSON.stringify({ name: packageName, exports: exportsValue }, null, 2) + "\n"
}

function writeFilePluginPackage(dir: string, packageName: string, exportsValue?: Record<string, unknown>): string {
  mkdirSync(dir, { recursive: true })
  writeFileSync(
    join(dir, "package.json"),
    createPackageJson(packageName, exportsValue),
    "utf-8",
  )
  return `file:${dir}`
}

function writeInstalledPackage(packageName: string, exportsValue?: Record<string, unknown>): void {
  const packageDir = join(testConfigDir, "node_modules", packageName)
  mkdirSync(packageDir, { recursive: true })
  writeFileSync(join(packageDir, "package.json"), createPackageJson(packageName, exportsValue), "utf-8")
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

  it("passes when both server and TUI package entries are registered", async () => {
    //#given opencode.json has the server entry, the installed package exports ./tui,
    //#      and tui.json has the package entry that OpenCode resolves as kind=tui
    writeInstalledPackage(PLUGIN_NAME, { ".": "./dist/index.js", "./tui": "./dist/tui.js" })
    writeOpenCodeConfig([PLUGIN_NAME])
    writeTuiConfig([PLUGIN_NAME])

    //#when running the check
    const result = await checkTuiPluginConfig()

    //#then both are detected and status is pass
    expect(result.status).toBe("pass")
    expect(result.issues).toHaveLength(0)
    expect(result.name).toBe("TUI Plugin")
  })

  it("passes when tui.json contains the package entry and a tuple plugin entry", async () => {
    //#given opencode.json has the server entry, the installed package exports ./tui,
    //#      and tui.json has the package entry plus a tuple-style custom TUI plugin
    writeInstalledPackage(PLUGIN_NAME, { ".": "./dist/index.js", "./tui": "./dist/tui.js" })
    writeOpenCodeConfig([PLUGIN_NAME])
    writeTuiConfig([PLUGIN_NAME, ["./badge.tsx", { label: "custom" }]])

    //#when running the check
    const result = await checkTuiPluginConfig()

    //#then the tuple entry is ignored and OMO's package entry still passes
    expect(result.status).toBe("pass")
    expect(result.issues).toHaveLength(0)
  })

  it("passes after ensureTuiPluginEntry adds the missing package TUI entry", async () => {
    writeInstalledPackage(PLUGIN_NAME, { ".": "./dist/index.js", "./tui": "./dist/tui.js" })
    writeOpenCodeConfig([PLUGIN_NAME])

    const ensureResult = ensureTuiPluginEntry({ configDir: testConfigDir })
    const result = await checkTuiPluginConfig()

    expect(ensureResult).toEqual({ changed: true, reason: "added" })
    expect(result.status).toBe("pass")
    expect(result.message).toContain("Server and TUI plugin entries are both registered")
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

  it("does not suggest a missing TUI entry when the installed package has no tui export", async () => {
    //#given opencode.json has the server entry, tui.json is missing the TUI entry,
    //#       and the installed published package has no ./tui export
    writeInstalledPackage(PLUGIN_NAME)
    writeOpenCodeConfig([PLUGIN_NAME])
    writeTuiConfig(["some-other-tui-plugin"])

    //#when running the check
    const result = await checkTuiPluginConfig()

    //#then doctor avoids recommending an unresolvable TUI plugin entry
    expect(result.status).toBe("pass")
    expect(result.issues).toHaveLength(0)
    expect(result.message).toContain("TUI subpath not shipped")
  })

  it("warns to remove an explicit TUI entry when the installed package has no tui export", async () => {
    //#given opencode.json has the server entry, tui.json has the broken TUI entry,
    //#       and the installed published package has no ./tui export
    writeInstalledPackage(PLUGIN_NAME)
    writeOpenCodeConfig([PLUGIN_NAME])
    writeTuiConfig([`${PLUGIN_NAME}/tui`])

    //#when running the check
    const result = await checkTuiPluginConfig()

    //#then doctor flags the unresolvable entry instead of blessing it
    expect(result.status).toBe("warn")
    expect(result.issues).toHaveLength(1)
    expect(result.issues[0].title).toContain("unresolvable")
    expect(result.issues[0].fix).toContain("Remove")
  })

  it("warns to remove a package subpath TUI entry even when the package exports tui", async () => {
    //#given opencode.json has the server entry, tui.json has the package subpath,
    //#      and the package does export ./tui
    writeInstalledPackage(PLUGIN_NAME, { ".": "./dist/index.js", "./tui": "./dist/tui.js" })
    writeOpenCodeConfig([PLUGIN_NAME])
    writeTuiConfig([`${PLUGIN_NAME}/tui`])

    //#when running the check
    const result = await checkTuiPluginConfig()

    //#then doctor still flags the package subpath because OpenCode installs the spec first
    expect(result.status).toBe("warn")
    expect(result.issues[0].title).toContain("unresolvable")
    expect(result.issues[0].fix).toContain(`add "${PLUGIN_NAME}"`)
  })

  it("does not warn for a file TUI entry when the server package has no tui export", async () => {
    //#given opencode.json has the server entry, the installed package has no ./tui export,
    //#       and tui.json uses a file: URL pointing at a local package that exports ./tui
    writeInstalledPackage(PLUGIN_NAME)
    writeOpenCodeConfig([PLUGIN_NAME])
    const localPkgDir = join(testConfigDir, "local-checkout")
    const fileEntry = writeFilePluginPackage(localPkgDir, "oh-my-opencode", {
      ".": "./dist/index.js",
      "./tui": "./dist/tui.js",
    })
    writeTuiConfig([fileEntry])

    //#when running the check
    const result = await checkTuiPluginConfig()

    //#then doctor does not treat the file: URL as an unresolvable named package subpath
    expect(result.status).toBe("pass")
    expect(result.issues).toHaveLength(0)
  })

  it("uses the registered server package when canonical and legacy installs disagree", async () => {
    //#given both package folders exist, but the registered server entry is canonical
    //#       and only the legacy folder exports ./tui
    writeInstalledPackage(PLUGIN_NAME)
    writeInstalledPackage("oh-my-opencode", { ".": "./dist/index.js", "./tui": "./dist/tui.js" })
    writeOpenCodeConfig([PLUGIN_NAME])
    writeTuiConfig([PLUGIN_NAME])

    //#when running the check
    const result = await checkTuiPluginConfig()

    //#then doctor diagnoses the canonical installed package instead of the legacy folder
    expect(result.status).toBe("warn")
    expect(result.issues[0].title).toContain("does not expose")
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
    const fileEntry = writeFilePluginPackage(localPkgDir, "oh-my-opencode", {
      ".": "./dist/index.js",
      "./tui": "./dist/tui.js",
    })
    writeTuiConfig([fileEntry])

    //#when running the check
    const result = await checkTuiPluginConfig()

    //#then file: entry satisfies registration and status is pass
    expect(result.status).toBe("pass")
    expect(result.issues).toHaveLength(0)
  })

  it("warns when tui.json has our entry but server plugin is missing from opencode.json", async () => {
    //#given tui.json has the TUI package entry but opencode.json does not have the server entry
    writeOpenCodeConfig(["some-other-plugin"])
    writeTuiConfig([PLUGIN_NAME])

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

  it("passes when legacy server entry is paired with legacy TUI package entry", async () => {
    //#given legacy package names in both configs
    writeOpenCodeConfig(["oh-my-opencode"])
    writeTuiConfig(["oh-my-opencode"])

    //#when running the check
    const result = await checkTuiPluginConfig()

    //#then legacy aliases are accepted
    expect(result.status).toBe("pass")
    expect(result.issues).toHaveLength(0)
  })
})
