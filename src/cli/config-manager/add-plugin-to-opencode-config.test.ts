import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test"
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

// Mock npm dist-tags fetch BEFORE importing the module under test, so the real
// network call never fires.
mock.module("./plugin-name-with-version", () => ({
  getPluginNameWithVersion: async (version: string) => `opencode-matrixx@${version}`,
}))

// Track temp dir so we can override the config-context module-level lookups.
let tempConfigDir = ""

mock.module("./config-context", () => ({
  getConfigDir: () => tempConfigDir,
  initConfigContext: () => {},
  resetConfigContext: () => {},
  getConfigJson: () => join(tempConfigDir, "opencode.json"),
  getConfigJsonc: () => join(tempConfigDir, "opencode.jsonc"),
  getMatrixxConfigPath: () => join(tempConfigDir, "matrixx", "config.jsonc"),
}))

// `opencode-config-format` calls `getConfigJson()` / `getConfigJsonc()` via
// existence checks against the filesystem at those paths — the mocked
// `config-context` above redirects those to our temp dir, so detection works
// against the test fixture without further mocking.

import { addPluginToOpenCodeConfig } from "./add-plugin-to-opencode-config"

describe("addPluginToOpenCodeConfig — legacy plugin name upgrade", () => {
  beforeEach(() => {
    tempConfigDir = mkdtempSync(join(tmpdir(), "matrixx-plugin-cfg-"))
  })

  afterEach(() => {
    rmSync(tempConfigDir, { recursive: true, force: true })
  })

  test("replaces legacy `matrixx@<version>` entry with `opencode-matrixx@<version>`", async () => {
    // #given a user with the broken legacy plugin entry in opencode.json
    const cfgPath = join(tempConfigDir, "opencode.json")
    writeFileSync(
      cfgPath,
      `${JSON.stringify({ plugin: ["matrixx@1.1.0", "some-other-plugin"] }, null, 2)}\n`
    )

    // #when re-running the installer with version 1.2.0
    const result = await addPluginToOpenCodeConfig("1.2.0")

    // #then the legacy entry should be replaced in-place (not duplicated)
    expect(result.success).toBe(true)
    const after = JSON.parse(readFileSync(cfgPath, "utf8")) as { plugin: string[] }
    expect(after.plugin).toEqual(["opencode-matrixx@1.2.0", "some-other-plugin"])
  })

  test("replaces bare legacy `matrixx` entry (no version pin) with versioned `opencode-matrixx@<version>`", async () => {
    // #given a user with the bare legacy plugin name (unpinned)
    const cfgPath = join(tempConfigDir, "opencode.json")
    writeFileSync(cfgPath, `${JSON.stringify({ plugin: ["matrixx"] }, null, 2)}\n`)

    // #when re-running the installer
    const result = await addPluginToOpenCodeConfig("1.2.0")

    // #then bare `matrixx` is replaced with the canonical pinned entry
    expect(result.success).toBe(true)
    const after = JSON.parse(readFileSync(cfgPath, "utf8")) as { plugin: string[] }
    expect(after.plugin).toEqual(["opencode-matrixx@1.2.0"])
  })

  test("updates existing `opencode-matrixx@<old>` entry to new version (no duplicate)", async () => {
    // #given a user already on the correct package name but stale version
    const cfgPath = join(tempConfigDir, "opencode.json")
    writeFileSync(
      cfgPath,
      `${JSON.stringify({ plugin: ["opencode-matrixx@1.0.0", "other"] }, null, 2)}\n`
    )

    // #when re-running the installer with a newer version
    const result = await addPluginToOpenCodeConfig("1.2.0")

    // #then the version is bumped in-place
    expect(result.success).toBe(true)
    const after = JSON.parse(readFileSync(cfgPath, "utf8")) as { plugin: string[] }
    expect(after.plugin).toEqual(["opencode-matrixx@1.2.0", "other"])
  })

  test("appends `opencode-matrixx@<version>` when no matrixx entry is present", async () => {
    // #given a fresh config with no matrixx-related plugin
    const cfgPath = join(tempConfigDir, "opencode.json")
    writeFileSync(cfgPath, `${JSON.stringify({ plugin: ["unrelated"] }, null, 2)}\n`)

    // #when running the installer for the first time
    const result = await addPluginToOpenCodeConfig("1.2.0")

    // #then the new entry is appended after existing plugins
    expect(result.success).toBe(true)
    const after = JSON.parse(readFileSync(cfgPath, "utf8")) as { plugin: string[] }
    expect(after.plugin).toEqual(["unrelated", "opencode-matrixx@1.2.0"])
  })

  test("does NOT touch entries that merely start with 'matrixx-' (false-positive guard)", async () => {
    // #given an unrelated plugin whose name happens to start with "matrixx-"
    const cfgPath = join(tempConfigDir, "opencode.json")
    writeFileSync(
      cfgPath,
      `${JSON.stringify({ plugin: ["matrixx-unrelated-plugin"] }, null, 2)}\n`
    )

    // #when running the installer
    const result = await addPluginToOpenCodeConfig("1.2.0")

    // #then the unrelated plugin is left alone and matrixx is appended
    expect(result.success).toBe(true)
    const after = JSON.parse(readFileSync(cfgPath, "utf8")) as { plugin: string[] }
    expect(after.plugin).toEqual([
      "matrixx-unrelated-plugin",
      "opencode-matrixx@1.2.0",
    ])
  })
})
