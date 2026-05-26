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
    expect(first.marketplaceName).toBe("code-yeongyu-codex-plugins")
    expect(second.installed.length).toBe(1)
    const configContent = await readFile(join(codexHome, "config.toml"), "utf8")
    expect(configContent).toContain("[features]")
    expect(configContent).toContain("[marketplaces.code-yeongyu-codex-plugins]")
    expect(configContent).toContain("[plugins.\"omo@code-yeongyu-codex-plugins\"]")
    expect(configContent).toContain("[hooks.state.")

    const pluginPath = first.installed[0]?.path
    expect(pluginPath).toBeDefined()
    const stats = await stat(pluginPath ?? "")
    expect(stats.isDirectory()).toBe(true)
  })
})
