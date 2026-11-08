import { afterEach, describe, expect, it } from "bun:test"
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { LEGACY_PLUGIN_NAME, PLUGIN_NAME } from "../../shared"
import { ensureTuiPluginEntry } from "./add-tui-plugin-to-tui-config"

const tempDirs: string[] = []

function tempConfigDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "omo-tui-config-"))
  tempDirs.push(dir)
  return dir
}

function writeConfig(dir: string, name: string, value: unknown): void {
  writeFileSync(join(dir, name), JSON.stringify(value, null, 2) + "\n", "utf-8")
}

function readTuiPlugins(dir: string): string[] {
  return JSON.parse(readFileSync(join(dir, "tui.json"), "utf-8")).plugin
}

function writeFilePackage(dir: string, name = PLUGIN_NAME): string {
  const packageDir = join(dir, "package")
  mkdirSync(packageDir, { recursive: true })
  writeConfig(packageDir, "package.json", { name, exports: { ".": "./dist/index.js", "./tui": "./dist/tui.js" } })
  return `file:${packageDir}`
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true })
  }
})

describe("ensureTuiPluginEntry", () => {
  it("#given named server entry #when ensuring TUI config #then it adds package entry once and preserves others", () => {
    // given
    const dir = tempConfigDir()
    writeConfig(dir, "opencode.json", { plugin: [PLUGIN_NAME] })
    writeConfig(dir, "tui.json", { plugin: ["some-other/tui"], theme: "dark" })

    // when
    const first = ensureTuiPluginEntry({ configDir: dir })
    const second = ensureTuiPluginEntry({ configDir: dir })

    // then
    expect(first).toEqual({ changed: true, reason: "added" })
    expect(second).toEqual({ changed: false, reason: "already-present" })
    expect(readTuiPlugins(dir)).toEqual(["some-other/tui", PLUGIN_NAME])
    expect(readFileSync(join(dir, "tui.json"), "utf-8")).toContain('"theme": "dark"')
  })

  it("#given versioned named server entry #when ensuring TUI config #then it reuses the package spec", () => {
    // given
    const dir = tempConfigDir()
    writeConfig(dir, "opencode.json", { plugin: [`${PLUGIN_NAME}@4.9.2`] })

    // when
    const result = ensureTuiPluginEntry({ configDir: dir })

    // then
    expect(result).toEqual({ changed: true, reason: "added" })
    expect(readTuiPlugins(dir)).toEqual([`${PLUGIN_NAME}@4.9.2`])
  })

  it("#given file server entry and stale named TUI entry #when ensuring #then it adds the matching file entry", () => {
    // given
    const dir = tempConfigDir()
    const fileEntry = writeFilePackage(dir)
    writeConfig(dir, "opencode.json", { plugin: [fileEntry] })
    writeConfig(dir, "tui.json", { plugin: [`${PLUGIN_NAME}/tui`] })

    // when
    const first = ensureTuiPluginEntry({ configDir: dir })
    const second = ensureTuiPluginEntry({ configDir: dir })

    // then
    expect(first).toEqual({ changed: true, reason: "added" })
    expect(second).toEqual({ changed: false, reason: "already-present" })
    expect(readTuiPlugins(dir)).toEqual([fileEntry])
  })

  it("#given legacy server entry #when legacy TUI entry already exists #then it does not duplicate", () => {
    // given
    const dir = tempConfigDir()
    writeConfig(dir, "opencode.json", { plugin: [LEGACY_PLUGIN_NAME] })
    writeConfig(dir, "tui.json", { plugin: [LEGACY_PLUGIN_NAME] })

    // when
    const result = ensureTuiPluginEntry({ configDir: dir })

    // then
    expect(result).toEqual({ changed: false, reason: "already-present" })
    expect(readTuiPlugins(dir)).toEqual([LEGACY_PLUGIN_NAME])
  })

  it("#given a stale tagged entry written by an older installer #when ensuring #then it replaces it with exactly one entry", () => {
    // given — 4.19.4 installers wrote `<pkg>@latest`; 5.x writes the bare name
    const dir = tempConfigDir()
    writeConfig(dir, "opencode.json", { plugin: [PLUGIN_NAME] })
    writeConfig(dir, "tui.json", { plugin: [`${PLUGIN_NAME}@latest`] })

    // when
    const result = ensureTuiPluginEntry({ configDir: dir })

    // then
    expect(result).toEqual({ changed: true, reason: "added" })
    expect(readTuiPlugins(dir)).toEqual([PLUGIN_NAME])
  })

  it("#given a legacy-name entry and unrelated plugins #when ensuring #then only our entry is replaced and order is preserved", () => {
    // given
    const dir = tempConfigDir()
    writeConfig(dir, "opencode.json", { plugin: [`${PLUGIN_NAME}@5.0.0`] })
    writeConfig(dir, "tui.json", {
      plugin: ["some-other/tui", `${LEGACY_PLUGIN_NAME}@4.19.4`, "another-plugin"],
    })

    // when
    const result = ensureTuiPluginEntry({ configDir: dir })

    // then
    expect(result).toEqual({ changed: true, reason: "added" })
    expect(readTuiPlugins(dir)).toEqual(["some-other/tui", "another-plugin", `${PLUGIN_NAME}@5.0.0`])
  })

  it("#given a tuple entry for our package #when ensuring #then it is replaced and foreign tuple entries survive", () => {
    // given
    const dir = tempConfigDir()
    writeConfig(dir, "opencode.json", { plugin: [PLUGIN_NAME] })
    writeConfig(dir, "tui.json", {
      plugin: [["some-other/tui", { enabled: true }], [`${PLUGIN_NAME}@beta`, { enabled: true }]],
    })

    // when
    const result = ensureTuiPluginEntry({ configDir: dir })

    // then
    expect(result).toEqual({ changed: true, reason: "added" })
    expect(readTuiPlugins(dir)).toEqual([["some-other/tui", { enabled: true }], PLUGIN_NAME])
  })

  it("#given a tuple server entry #when ensuring #then it rewrites tui.json from the tuple name", () => {
    // given — addPluginToOpenCodeConfig keeps [name, options]; the TUI writer must still see it
    const dir = tempConfigDir()
    writeConfig(dir, "opencode.json", { plugin: [[PLUGIN_NAME, { verbose: true }]] })
    writeConfig(dir, "tui.json", {
      plugin: [`${PLUGIN_NAME}@latest`, PLUGIN_NAME, ["foreign/tui", { enabled: true }]],
    })

    // when
    const result = ensureTuiPluginEntry({ configDir: dir })

    // then
    expect(result).toEqual({ changed: true, reason: "added" })
    expect(readTuiPlugins(dir)).toEqual([["foreign/tui", { enabled: true }], PLUGIN_NAME])
  })

  it("#given plugin field missing #when ensuring #then it writes exactly one entry", () => {
    // given
    const dir = tempConfigDir()
    writeConfig(dir, "opencode.json", { plugin: [PLUGIN_NAME] })
    writeConfig(dir, "tui.json", { theme: "dark" })

    // when
    const result = ensureTuiPluginEntry({ configDir: dir })

    // then
    expect(result).toEqual({ changed: true, reason: "added" })
    expect(readTuiPlugins(dir)).toEqual([PLUGIN_NAME])
    expect(readFileSync(join(dir, "tui.json"), "utf-8")).toContain('"theme": "dark"')
  })

  it("#given plugin field is a foreign string #when ensuring #then the foreign spec is kept as an entry", () => {
    // given
    const dir = tempConfigDir()
    writeConfig(dir, "opencode.json", { plugin: [PLUGIN_NAME] })
    writeConfig(dir, "tui.json", { plugin: "some-foreign-plugin", theme: "dark" })

    // when
    const result = ensureTuiPluginEntry({ configDir: dir })

    // then
    expect(result).toEqual({ changed: true, reason: "added" })
    expect(readTuiPlugins(dir)).toEqual(["some-foreign-plugin", PLUGIN_NAME])
  })

  it("#given plugin field is an object #when ensuring #then it does not write", () => {
    // given
    const dir = tempConfigDir()
    writeConfig(dir, "opencode.json", { plugin: [PLUGIN_NAME] })
    writeConfig(dir, "tui.json", { plugin: { foo: true }, theme: "dark" })

    // when
    const result = ensureTuiPluginEntry({ configDir: dir })

    // then
    expect(result).toEqual({ changed: false, reason: "malformed" })
    expect(JSON.parse(readFileSync(join(dir, "tui.json"), "utf-8"))).toEqual({
      plugin: { foo: true },
      theme: "dark",
    })
  })

  it("#given null and number entries plus a stale tagged spec #when ensuring #then junk is kept and our spec is unique", () => {
    // given
    const dir = tempConfigDir()
    writeConfig(dir, "opencode.json", { plugin: [PLUGIN_NAME] })
    writeConfig(dir, "tui.json", { plugin: [null, 42, `${PLUGIN_NAME}@latest`] })

    // when
    const result = ensureTuiPluginEntry({ configDir: dir })

    // then
    expect(result).toEqual({ changed: true, reason: "added" })
    expect(readTuiPlugins(dir)).toEqual([null, 42, PLUGIN_NAME])
  })

  it("#given a foreign tuple whose name is a prefix of ours #when ensuring #then that tuple survives", () => {
    // given
    const dir = tempConfigDir()
    writeConfig(dir, "opencode.json", { plugin: [PLUGIN_NAME] })
    writeConfig(dir, "tui.json", {
      plugin: ["oh-my-openagent-extra", ["oh-my-openagent-extra", { enabled: true }], `${PLUGIN_NAME}@latest`],
    })

    // when
    const result = ensureTuiPluginEntry({ configDir: dir })

    // then
    expect(result).toEqual({ changed: true, reason: "added" })
    expect(readTuiPlugins(dir)).toEqual([
      "oh-my-openagent-extra",
      ["oh-my-openagent-extra", { enabled: true }],
      PLUGIN_NAME,
    ])
  })

  it("#given a file: entry pointing at another package #when ensuring #then it survives", () => {
    // given
    const dir = tempConfigDir()
    const otherPkg = join(dir, "other-pkg")
    mkdirSync(otherPkg, { recursive: true })
    writeConfig(otherPkg, "package.json", { name: "some-other-plugin" })
    writeConfig(dir, "opencode.json", { plugin: [PLUGIN_NAME] })
    writeConfig(dir, "tui.json", { plugin: [`file:${otherPkg}`, `${PLUGIN_NAME}@latest`] })

    // when
    const result = ensureTuiPluginEntry({ configDir: dir })

    // then
    expect(result).toEqual({ changed: true, reason: "added" })
    expect(readTuiPlugins(dir)).toEqual([`file:${otherPkg}`, PLUGIN_NAME])
  })

  it("#given a Windows file: path pointing elsewhere #when ensuring #then it survives", () => {
    // given
    const dir = tempConfigDir()
    writeConfig(dir, "opencode.json", { plugin: [PLUGIN_NAME] })
    writeConfig(dir, "tui.json", { plugin: ["file:C:\\Users\\other\\plugin", `${PLUGIN_NAME}@latest`] })

    // when
    const result = ensureTuiPluginEntry({ configDir: dir })

    // then
    expect(result).toEqual({ changed: true, reason: "added" })
    expect(readTuiPlugins(dir)).toEqual(["file:C:\\Users\\other\\plugin", PLUGIN_NAME])
  })

  it("#given the desired entry already present twice #when ensuring #then it collapses to one", () => {
    // given
    const dir = tempConfigDir()
    writeConfig(dir, "opencode.json", { plugin: [PLUGIN_NAME] })
    writeConfig(dir, "tui.json", { plugin: [PLUGIN_NAME, PLUGIN_NAME] })

    // when
    const first = ensureTuiPluginEntry({ configDir: dir })
    const second = ensureTuiPluginEntry({ configDir: dir })

    // then
    expect(first).toEqual({ changed: true, reason: "added" })
    expect(second).toEqual({ changed: false, reason: "already-present" })
    expect(readTuiPlugins(dir)).toEqual([PLUGIN_NAME])
  })

  it("#given an opencode.json source file:// leftover in tui.json #when ensuring #then only the desired package spec remains", () => {
    // given — same source shape addPluginToOpenCodeConfig treats as ours
    const dir = tempConfigDir()
    writeConfig(dir, "opencode.json", { plugin: [PLUGIN_NAME] })
    writeConfig(dir, "tui.json", {
      plugin: ["file:///repo/oh-my-openagent/src/index.ts", `${PLUGIN_NAME}@latest`],
    })

    // when
    const result = ensureTuiPluginEntry({ configDir: dir })

    // then
    expect(result).toEqual({ changed: true, reason: "added" })
    expect(readTuiPlugins(dir)).toEqual([PLUGIN_NAME])
  })

  it("#given missing or source-only server entry #when ensuring #then it does not write", () => {
    // given
    const missing = tempConfigDir()
    const sourceOnly = tempConfigDir()
    writeConfig(sourceOnly, "opencode.json", { plugin: ["file:///repo/src/index.ts"] })

    // when
    const missingResult = ensureTuiPluginEntry({ configDir: missing })
    const sourceResult = ensureTuiPluginEntry({ configDir: sourceOnly })

    // then
    expect(missingResult).toEqual({ changed: false, reason: "no-server-entry" })
    expect(sourceResult).toEqual({ changed: false, reason: "no-server-entry" })
    expect(existsSync(join(missing, "tui.json"))).toBe(false)
    expect(existsSync(join(sourceOnly, "tui.json"))).toBe(false)
  })

  it("#given malformed TUI config #when ensuring #then it preserves the original file and leaves no temp", () => {
    // given
    const dir = tempConfigDir()
    writeConfig(dir, "opencode.json", { plugin: [PLUGIN_NAME] })
    writeFileSync(join(dir, "tui.json"), "{bad json", "utf-8")

    // when
    const result = ensureTuiPluginEntry({ configDir: dir })

    // then
    expect(result).toEqual({ changed: false, reason: "malformed" })
    expect(readFileSync(join(dir, "tui.json"), "utf-8")).toBe("{bad json")
    expect(existsSync(join(dir, "tui.json.tmp"))).toBe(false)
  })
})
