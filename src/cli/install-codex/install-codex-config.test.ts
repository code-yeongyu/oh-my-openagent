/// <reference path="../../../bun-test.d.ts" />
/// <reference types="bun-types" />

import { describe, expect, test } from "bun:test"
import { mkdir, mkdtemp, readFile, readlink, rm, stat, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { runCodexInstaller } from "./install-codex"

describe("install-codex config persistence", () => {
  test("#given Codex prunes an old plugin cache version #when agent role files were installed #then roles still resolve through the marketplace snapshot", async () => {
    // given
    const codexHome = await mkdtemp(join(tmpdir(), "omo-codex-home-autoupdate-"))
    const binDir = await mkdtemp(join(tmpdir(), "omo-codex-bin-autoupdate-"))
    const repoRoot = process.cwd()
    const marketplaceRoot = join(codexHome, ".tmp", "marketplaces", "sisyphuslabs")
    await mkdir(join(marketplaceRoot, ".git"), { recursive: true })
    await writeFile(join(marketplaceRoot, ".git", "config"), "[remote \"origin\"]\n")
    await writeFile(join(marketplaceRoot, ".codex-marketplace-install.json"), '{"source_type":"git"}\n')

    // when
    const result = await runCodexInstaller({ codexHome, binDir, repoRoot, runCommand: async () => undefined })
    const pluginPath = result.installed[0]?.path ?? ""
    await rm(pluginPath, { recursive: true, force: true })

    // then
    const explorerAgentPath = join(codexHome, "agents", "explorer.toml")
    const explorerSnapshotPath = join(
      codexHome,
      ".tmp",
      "marketplaces",
      "sisyphuslabs",
      "plugins",
      "omo",
      "components",
      "ultrawork",
      "agents",
      "explorer.toml",
    )
    if (process.platform === "win32") {
      expect(await readFile(explorerAgentPath, "utf8")).toBe(await readFile(explorerSnapshotPath, "utf8"))
    } else {
      expect(await readlink(explorerAgentPath)).toBe(explorerSnapshotPath)
    }
    expect(await readFile(explorerAgentPath, "utf8")).toContain('name = "explorer"')
    expect(await readFile(join(marketplaceRoot, ".git", "config"), "utf8")).toBe("[remote \"origin\"]\n")
    expect(await readFile(join(marketplaceRoot, ".codex-marketplace-install.json"), "utf8")).toBe(
      '{"source_type":"git"}\n',
    )
    const snapshotPluginPath = join(marketplaceRoot, "plugins", "omo")
    const snapshotMcpManifest: {
      readonly mcpServers: {
        readonly ast_grep: { readonly args: readonly string[] }
        readonly git_bash: { readonly args: readonly string[] }
        readonly lsp: { readonly args: readonly string[] }
      }
    } = JSON.parse(await readFile(join(snapshotPluginPath, ".mcp.json"), "utf8"))
    expect(snapshotMcpManifest.mcpServers.ast_grep.args[0]).toBe(
      join(snapshotPluginPath, "components", "ast-grep-mcp", "dist", "cli.js"),
    )
    expect((await stat(snapshotMcpManifest.mcpServers.ast_grep.args[0] ?? "")).isFile()).toBe(true)
    expect(snapshotMcpManifest.mcpServers.git_bash.args[0]).toBe(
      join(snapshotPluginPath, "components", "git-bash-mcp", "dist", "cli.js"),
    )
    expect((await stat(snapshotMcpManifest.mcpServers.git_bash.args[0] ?? "")).isFile()).toBe(true)
    expect(snapshotMcpManifest.mcpServers.lsp.args[0]).toBe(
      join(snapshotPluginPath, "components", "lsp-tools-mcp", "dist", "cli.js"),
    )
    expect(snapshotMcpManifest.mcpServers.lsp.args[0]).not.toContain("../../lsp-tools-mcp")
    expect(snapshotMcpManifest.mcpServers.lsp.args[0]).not.toContain("components/lsp/packages")
    expect((await stat(snapshotMcpManifest.mcpServers.lsp.args[0] ?? "")).isFile()).toBe(true)
  })

  test("#given autonomous permissions requested #when installing omo #then writes Codex autonomy settings", async () => {
    // given
    const codexHome = await mkdtemp(join(tmpdir(), "omo-codex-autonomous-home-"))
    const binDir = await mkdtemp(join(tmpdir(), "omo-codex-autonomous-bin-"))
    const repoRoot = process.cwd()

    // when
    await runCodexInstaller({
      codexHome,
      binDir,
      repoRoot,
      runCommand: async () => undefined,
      autonomousPermissions: true,
    })

    // then
    const configContent = await readFile(join(codexHome, "config.toml"), "utf8")
    expect(configContent).toContain('approval_policy = "never"')
    expect(configContent).toContain('sandbox_mode = "danger-full-access"')
    expect(configContent).toContain('network_access = "enabled"')
    expect(configContent).toContain("hide_full_access_warning = true")
    expect(configContent).toContain("hide_world_writable_warning = true")
  })
})
