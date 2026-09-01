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
