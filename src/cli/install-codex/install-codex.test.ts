/// <reference path="../../../bun-test.d.ts" />
/// <reference types="bun-types" />

import { describe, expect, test } from "bun:test"
import { mkdtemp, readFile, stat } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { runCodexInstaller } from "./install-codex"

describe("install-codex", () => {
  test("installs vendored plugin into codex home and stays idempotent", async () => {
    // given
    const codexHome = await mkdtemp(join(tmpdir(), "omo-codex-home-"))
    const binDir = await mkdtemp(join(tmpdir(), "omo-codex-bin-"))
    const repoRoot = process.cwd()

    // when
    const first = await runCodexInstaller({ codexHome, binDir, repoRoot, runCommand: async () => undefined })
    const second = await runCodexInstaller({ codexHome, binDir, repoRoot, runCommand: async () => undefined })

    // then
    expect(first.marketplaceName).toBe("sisyphuslabs")
    expect(second.installed.length).toBe(1)
    const configContent = await readFile(join(codexHome, "config.toml"), "utf8")
    expect(configContent).toContain("[features]")
    expect(configContent).toContain("[marketplaces.sisyphuslabs]")
    expect(configContent).toContain('source_type = "git"')
    expect(configContent).toContain('source = "https://github.com/code-yeongyu/lazycodex.git"')
    expect(configContent).toContain('ref = "main"')
    expect(configContent).toContain("[plugins.\"omo@sisyphuslabs\"]")
    expect(configContent).toContain("[hooks.state.")
    expect(configContent).not.toContain("code-yeongyu-codex-plugins")
    expect(configContent).not.toContain("[marketplaces.lazycodex]")

    const pluginPath = first.installed[0]?.path
    expect(pluginPath).toBeDefined()
    expect(pluginPath).toContain(join("plugins", "cache", "sisyphuslabs", "omo"))
    const stats = await stat(pluginPath ?? "")
    expect(stats.isDirectory()).toBe(true)
  })
})
