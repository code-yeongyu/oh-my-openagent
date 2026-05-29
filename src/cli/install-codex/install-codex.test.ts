/// <reference path="../../../bun-test.d.ts" />
/// <reference types="bun-types" />

import { describe, expect, test } from "bun:test"
import { mkdir, mkdtemp, readFile, stat, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { resolveCodexInstallerBinDir, runCodexInstaller } from "./install-codex"

describe("install-codex", () => {
  test("#given default CODEX_HOME #when resolving installer bin dir without override #then preserves user local bin precedence", () => {
    // given
    const homeDir = join(tmpdir(), "omo-codex-home-default")
    const codexHome = join(homeDir, ".codex")

    // when
    const binDir = resolveCodexInstallerBinDir({ codexHome, env: {}, homeDir })

    // then
    expect(binDir).toBe(join(homeDir, ".local", "bin"))
  })

  test("#given custom CODEX_HOME #when resolving installer bin dir without override #then keeps generated omo inside that Codex home", () => {
    // given
    const homeDir = join(tmpdir(), "omo-codex-home-custom")
    const codexHome = join(tmpdir(), "omo-codex-install-custom")

    // when
    const binDir = resolveCodexInstallerBinDir({ codexHome, env: {}, homeDir })

    // then
    expect(binDir).toBe(join(codexHome, "bin"))
  })

  test("#given explicit CODEX_LOCAL_BIN_DIR #when resolving installer bin dir #then preserves installed omo precedence", () => {
    // given
    const homeDir = join(tmpdir(), "omo-codex-home-explicit")
    const codexHome = join(tmpdir(), "omo-codex-install-explicit")
    const explicitBinDir = join(tmpdir(), "omo-codex-explicit-bin")

    // when
    const binDir = resolveCodexInstallerBinDir({
      codexHome,
      env: { CODEX_LOCAL_BIN_DIR: explicitBinDir },
      homeDir,
    })

    // then
    expect(binDir).toBe(explicitBinDir)
  })

  test("installs vendored plugin into codex home and stays idempotent", async () => {
    // given
    const codexHome = await mkdtemp(join(tmpdir(), "omo-codex-home-"))
    const binDir = await mkdtemp(join(tmpdir(), "omo-codex-bin-"))
    const repoRoot = process.cwd()
    const legacyCacheRoot = join(codexHome, "plugins", "cache", "code-yeongyu-codex-plugins", "omo", "0.1.0")
    await mkdir(legacyCacheRoot, { recursive: true })
    await writeFile(join(legacyCacheRoot, ".mcp.json"), JSON.stringify({ mcpServers: { lsp: { args: ["old-lsp"] } } }))

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
    expect(configContent).toContain("[agents.explorer]")
    expect(configContent).toContain('config_file = "./agents/explorer.toml"')
    expect(configContent).toContain("[agents.librarian]")
    expect(configContent).toContain('config_file = "./agents/librarian.toml"')
    expect(configContent).toContain("[agents.plan]")
    expect(configContent).toContain('config_file = "./agents/plan.toml"')
    expect(configContent).not.toContain("code-yeongyu-codex-plugins")
    expect(configContent).not.toContain("[marketplaces.lazycodex]")

    const pluginPath = first.installed[0]?.path
    expect(pluginPath).toBeDefined()
    expect(pluginPath).toContain(join("plugins", "cache", "sisyphuslabs", "omo"))
    const stats = await stat(pluginPath ?? "")
    expect(stats.isDirectory()).toBe(true)
    expect((await stat(join(codexHome, "agents", "explorer.toml"))).isFile()).toBe(true)
    expect((await stat(join(codexHome, "agents", "librarian.toml"))).isFile()).toBe(true)
    expect((await stat(join(codexHome, "agents", "plan.toml"))).isFile()).toBe(true)
    await expect(stat(join(codexHome, "plugins", "cache", "code-yeongyu-codex-plugins", "omo"))).rejects.toThrow()
  })
})
