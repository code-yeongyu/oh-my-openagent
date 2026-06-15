/// <reference path="../../../../bun-test.d.ts" />
/// <reference types="bun-types" />

import { describe, expect, test } from "bun:test"
import { mkdir, mkdtemp, readdir, readFile, stat, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { findRepoRoot, findRepoRootFromImporter, resolveCodexInstallerBinDir, runCodexInstaller } from "./install-codex"
import { createRepoWithBuiltComponentBins } from "./install-codex-test-fixtures"

const INSTALL_CODEX_INTEGRATION_TEST_TIMEOUT_MS = process.platform === "win32" ? 60_000 : 20_000

function formatTomlString(value: string): string {
  return JSON.stringify(value)
}

describe("install-codex", () => {
  test("#given npm platform binary package #when resolving vendored repo root #then finds sibling wrapper package", async () => {
    // given
    const nodeModules = await mkdtemp(join(tmpdir(), "omo-codex-node-modules-"))
    const importerDir = join(nodeModules, "oh-my-openagent-darwin-arm64", "bin")
    const wrapperRoot = join(nodeModules, "oh-my-openagent")
    await mkdir(join(importerDir), { recursive: true })
    await mkdir(join(wrapperRoot, "packages", "omo-codex", "plugin", ".codex-plugin"), { recursive: true })
    await writeFile(join(wrapperRoot, "packages", "omo-codex", "plugin", ".codex-plugin", "plugin.json"), "{}")

    // when
    const repoRoot = findRepoRootFromImporter(importerDir)

    // then
    expect(repoRoot).toBe(wrapperRoot)
  })

  test("#given wrapper root env #when resolving vendored repo root #then prefers wrapper package root", async () => {
    // given
    const platformPackageRoot = await mkdtemp(join(tmpdir(), "omo-codex-platform-package-"))
    const wrapperRoot = await mkdtemp(join(tmpdir(), "omo-codex-wrapper-package-"))
    await mkdir(join(wrapperRoot, "packages", "omo-codex", "plugin", ".codex-plugin"), { recursive: true })
    await writeFile(join(wrapperRoot, "packages", "omo-codex", "plugin", ".codex-plugin", "plugin.json"), "{}")

    // when
    const repoRoot = findRepoRoot({
      importerDir: join(platformPackageRoot, "bin"),
      env: { OMO_WRAPPER_PACKAGE_ROOT: wrapperRoot },
    })

    // then
    expect(repoRoot).toBe(wrapperRoot)
  })

  test("#given canonical installer package nesting #when resolving vendored repo root #then walks past the legacy five-parent cap", async () => {
    // given
    const repoRoot = await mkdtemp(join(tmpdir(), "omo-codex-deep-nesting-"))
    await mkdir(join(repoRoot, "packages", "omo-codex", "plugin", ".codex-plugin"), { recursive: true })
    await writeFile(join(repoRoot, "packages", "omo-codex", "plugin", ".codex-plugin", "plugin.json"), "{}")
    const importerDir = join(repoRoot, "packages", "omo-codex", "src", "install")
    await mkdir(importerDir, { recursive: true })

    // when
    const fromImporter = findRepoRootFromImporter(importerDir)
    const fromFindRepoRoot = findRepoRoot({ importerDir })

    // then
    expect(fromImporter).toBe(repoRoot)
    expect(fromFindRepoRoot).toBe(repoRoot)
  })

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

  test("#given codex installer #when installing omo #then registers local marketplace and cached plugin", async () => {
    // given
    const codexHome = await mkdtemp(join(tmpdir(), "omo-codex-home-"))
    const binDir = await mkdtemp(join(tmpdir(), "omo-codex-bin-"))
    const repoRoot = process.cwd()
    const legacyCacheRoot = join(codexHome, "plugins", "cache", "code-yeongyu-codex-plugins", "omo", "0.1.0")
    await mkdir(legacyCacheRoot, { recursive: true })
    await writeFile(join(legacyCacheRoot, ".mcp.json"), JSON.stringify({ mcpServers: { lsp: { args: ["old-lsp"] } } }))

    // when
    const first = await runCodexInstaller({ codexHome, binDir, repoRoot, runCommand: async () => undefined })

    // then
    expect(first.marketplaceName).toBe("sisyphuslabs")
    expect(first.installed.length).toBe(1)
    const configContent = await readFile(join(codexHome, "config.toml"), "utf8")
    expect(configContent).toContain("[features]")
    expect(configContent).toContain("[marketplaces.sisyphuslabs]")
    expect(configContent).toContain('source_type = "local"')
    expect(configContent).toContain(`source = ${formatTomlString(join(codexHome, "plugins", "cache", "sisyphuslabs"))}`)
    expect(configContent).not.toContain('source = "https://github.com/code-yeongyu/lazycodex.git"')
    expect(configContent).not.toContain('ref = "main"')
    expect(configContent).toContain("[plugins.\"omo@sisyphuslabs\"]")
    expect(configContent).toContain("[hooks.state.")
    expect(configContent).not.toContain("code-yeongyu-codex-plugins")
    expect(configContent).not.toContain("[marketplaces.lazycodex]")

    const pluginPath = first.installed[0]?.path
    expect(pluginPath).toBeDefined()
    expect(pluginPath).toContain(join("plugins", "cache", "sisyphuslabs", "omo"))
    const stats = await stat(pluginPath ?? "")
    expect(stats.isDirectory()).toBe(true)
    const rootPackage = JSON.parse(await readFile(join(repoRoot, "package.json"), "utf8")) as { readonly name: string; readonly version: string }
    const distributionSnapshot = JSON.parse(await readFile(join(pluginPath ?? "", "lazycodex-install.json"), "utf8")) as {
      readonly packageName: string
      readonly version: string
    }
    expect(distributionSnapshot).toEqual({ packageName: rootPackage.name, version: rootPackage.version })
    let rootSkillNames: readonly string[] = []
    try {
      rootSkillNames = (await readdir(join(pluginPath ?? "", "skills"), { withFileTypes: true }))
        .filter((entry) => entry.isDirectory())
        .map((entry) => entry.name)
        .sort()
    } catch (error) {
      if (!(error instanceof Error)) throw error
    }
    if (rootSkillNames.length > 0) {
      expect(rootSkillNames).toContain("ulw-plan")
      expect(rootSkillNames).toContain("ulw-loop")
      expect(rootSkillNames).not.toContain("planing-prometheustic")
    }
    expect((await stat(join(pluginPath ?? "", "components", "ultrawork", "skills", "ulw-plan"))).isDirectory()).toBe(true)
    expect((await stat(join(pluginPath ?? "", "components", "ulw-loop", "skills", "ulw-loop"))).isDirectory()).toBe(true)
    const mcpManifest = JSON.parse(await readFile(join(pluginPath ?? "", ".mcp.json"), "utf8")) as {
      mcpServers: { ast_grep: { args: string[] }; git_bash: { args: string[] }; lsp: { args: string[] } }
    }
    expect(mcpManifest.mcpServers.ast_grep.args[0]).toBe(join(pluginPath ?? "", "components", "ast-grep-mcp", "dist", "cli.js"))
    expect((await stat(mcpManifest.mcpServers.ast_grep.args[0] ?? "")).isFile()).toBe(true)
    expect(mcpManifest.mcpServers.git_bash.args[0]).toBe(join(pluginPath ?? "", "components", "git-bash-mcp", "dist", "cli.js"))
    expect((await stat(mcpManifest.mcpServers.git_bash.args[0] ?? "")).isFile()).toBe(true)
    expect(mcpManifest.mcpServers.lsp.args[0]).toBe(join(pluginPath ?? "", "components", "lsp-daemon", "dist", "cli.js"))
    expect(mcpManifest.mcpServers.lsp.args[0]).not.toContain("components/lsp/packages")
    expect(mcpManifest.mcpServers.lsp.args[0]?.startsWith(pluginPath ?? "")).toBe(true)
    expect((await stat(mcpManifest.mcpServers.lsp.args[0] ?? "")).isFile()).toBe(true)
    const marketplace = JSON.parse(
      await readFile(join(codexHome, "plugins", "cache", "sisyphuslabs", ".agents", "plugins", "marketplace.json"), "utf8"),
    ) as { plugins: Array<{ name: string; source: { source: string; path: string } }> }
    expect(marketplace.plugins).toEqual([{ name: "omo", source: { source: "local", path: `./omo/${rootPackage.version}` } }])
    let legacyCacheMissing = false
    try {
      await stat(join(codexHome, "plugins", "cache", "code-yeongyu-codex-plugins", "omo"))
    } catch (error) {
      legacyCacheMissing = error instanceof Error
    }
    expect(legacyCacheMissing).toBe(true)
  }, { timeout: INSTALL_CODEX_INTEGRATION_TEST_TIMEOUT_MS })

  test("#given simulated Windows Codex install #when installing omo #then enables git_bash MCP and trusts shell hooks", async () => {
    // given
    const codexHome = await mkdtemp(join(tmpdir(), "omo-codex-home-git-bash-win-"))
    const binDir = await mkdtemp(join(tmpdir(), "omo-codex-bin-git-bash-win-"))
    const repoRoot = await createRepoWithBuiltComponentBins({ includeBundledGitBashMcp: true })

    // when
    const result = await runCodexInstaller({
      codexHome,
      binDir,
      repoRoot,
      platform: "win32",
      gitBashResolver: () => ({ found: true, path: "C:\\Program Files\\Git\\bin\\bash.exe", source: "program-files" }),
      runCommand: async () => undefined,
    })

    // then
    const configContent = await readFile(join(codexHome, "config.toml"), "utf8")
    expect(configContent).toContain('[plugins."omo@sisyphuslabs".mcp_servers.git_bash]')
    expect(configContent).toContain("enabled = true")
    expect(configContent).toContain("pre_tool_use")
    expect(configContent).toContain("post_compact")
    expect(result.gitBashPath).toBe("C:\\Program Files\\Git\\bin\\bash.exe")
    const pluginPath = result.installed[0]?.path ?? ""
    const mcpManifest = JSON.parse(await readFile(join(pluginPath, ".mcp.json"), "utf8")) as {
      readonly mcpServers: { readonly git_bash: { readonly args: readonly string[] } }
    }
    expect(mcpManifest.mcpServers.git_bash.args[0]).toBe(join(pluginPath, "components", "git-bash-mcp", "dist", "cli.js"))
    expect((await stat(mcpManifest.mcpServers.git_bash.args[0] ?? "")).isFile()).toBe(true)
  }, { timeout: INSTALL_CODEX_INTEGRATION_TEST_TIMEOUT_MS })

  test("#given simulated Linux Codex install #when installing omo #then keeps git_bash manifest but disables policy exposure", async () => {
    // given
    const codexHome = await mkdtemp(join(tmpdir(), "omo-codex-home-git-bash-linux-"))
    const binDir = await mkdtemp(join(tmpdir(), "omo-codex-bin-git-bash-linux-"))
    const repoRoot = await createRepoWithBuiltComponentBins({ includeBundledGitBashMcp: true })

    // when
    const result = await runCodexInstaller({
      codexHome,
      binDir,
      repoRoot,
      platform: "linux",
      runCommand: async () => undefined,
    })

    // then
    const configContent = await readFile(join(codexHome, "config.toml"), "utf8")
    expect(configContent).toContain('[plugins."omo@sisyphuslabs".mcp_servers.git_bash]')
    expect(configContent).toContain("enabled = false")
    const pluginPath = result.installed[0]?.path ?? ""
    const mcpManifest = JSON.parse(await readFile(join(pluginPath, ".mcp.json"), "utf8")) as {
      readonly mcpServers: { readonly git_bash: { readonly args: readonly string[] } }
    }
    expect(mcpManifest.mcpServers.git_bash.args[0]).toBe(join(pluginPath, "components", "git-bash-mcp", "dist", "cli.js"))
  }, { timeout: INSTALL_CODEX_INTEGRATION_TEST_TIMEOUT_MS })

  test("#given repoRoot without root CLI dist #when installing omo #then warns about the skipped omo runtime wrapper", async () => {
    // given
    const codexHome = await mkdtemp(join(tmpdir(), "omo-codex-home-no-dist-"))
    const binDir = await mkdtemp(join(tmpdir(), "omo-codex-bin-no-dist-"))
    const repoRoot = await createRepoWithBuiltComponentBins({ includeRootCliDist: false })
    const logs: string[] = []

    // when
    await runCodexInstaller({ codexHome, binDir, repoRoot, runCommand: async () => undefined, log: (line) => logs.push(line) })

    // then
    const cliPath = join(repoRoot, "dist", "cli", "index.js")
    const wrapperWarnings = logs.filter((line) => line.includes("omo runtime wrapper"))
    expect(wrapperWarnings.length).toBeGreaterThan(0)
    expect(wrapperWarnings.join("\n")).toContain(cliPath)
    const linkedNames = await readdir(binDir)
    const rootCliBinName = process.platform === "win32" ? "omo.cmd" : "omo"
    expect(linkedNames).not.toContain(rootCliBinName)
  }, { timeout: INSTALL_CODEX_INTEGRATION_TEST_TIMEOUT_MS })

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
  }, { timeout: INSTALL_CODEX_INTEGRATION_TEST_TIMEOUT_MS })
})
