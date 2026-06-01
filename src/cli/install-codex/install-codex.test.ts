/// <reference path="../../../bun-test.d.ts" />
/// <reference types="bun-types" />

import { describe, expect, test } from "bun:test"
import * as bunTest from "bun:test"
import { mkdir, mkdtemp, readdir, readFile, readlink, stat, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { findRepoRoot, findRepoRootFromImporter, resolveCodexInstallerBinDir, runCodexInstaller } from "./install-codex"

type BunTestWithDefaultTimeout = typeof bunTest & {
  setDefaultTimeout(milliseconds: number): void
}

if (process.platform === "win32") {
  ;(bunTest as BunTestWithDefaultTimeout).setDefaultTimeout(10_000)
}

const EXPECTED_OMO_COMPONENT_BINS = [
  { name: "omo", target: join("components", "ulw-loop", "dist", "cli.js") },
  { name: "omo-comment-checker", target: join("components", "comment-checker", "dist", "cli.js") },
  { name: "omo-git-bash-hook", target: join("components", "git-bash", "dist", "cli.js") },
  { name: "omo-lsp", target: join("components", "lsp", "dist", "cli.js") },
  { name: "omo-rules", target: join("components", "rules", "dist", "cli.js") },
  { name: "omo-start-work-continuation", target: join("components", "start-work-continuation", "dist", "cli.js") },
  { name: "omo-telemetry", target: join("components", "telemetry", "dist", "cli.js") },
  { name: "omo-ultrawork", target: join("components", "ultrawork", "dist", "cli.js") },
] as const

const STALE_CODEX_COMPONENT_BINS = [
  "codex-comment-checker",
  "codex-rules",
  "codex-start-work-continuation",
  "codex-telemetry",
  "codex-ultrawork",
] as const

function formatTomlString(value: string): string {
  return JSON.stringify(value)
}

function expectedBinName(name: string): string {
  return process.platform === "win32" ? `${name}.cmd` : name
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
    const first = await runCodexInstaller({ codexHome, binDir, repoRoot, env: { PATH: "" }, runCommand: async () => undefined })

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
    for (const agentName of ["codex-ultrawork-reviewer", "explorer", "librarian", "metis", "momus", "plan"]) {
      expect(configContent).toContain(`[agents.${agentName}]`)
      expect(configContent).toContain(`config_file = "./agents/${agentName}.toml"`)
    }
    expect(configContent).not.toContain("code-yeongyu-codex-plugins")
    expect(configContent).not.toContain("[marketplaces.lazycodex]")

    const pluginPath = first.installed[0]?.path
    expect(pluginPath).toBeDefined()
    expect(pluginPath).toContain(join("plugins", "cache", "sisyphuslabs", "omo"))
    const stats = await stat(pluginPath ?? "")
    expect(stats.isDirectory()).toBe(true)
    const skillNames = (await readdir(join(pluginPath ?? "", "skills"), { withFileTypes: true }))
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .sort()
    expect(skillNames).toContain("ulw-plan")
    expect(skillNames).toContain("ulw-loop")
    expect(skillNames).not.toContain("planing-prometheustic")
    const mcpManifest = JSON.parse(await readFile(join(pluginPath ?? "", ".mcp.json"), "utf8")) as {
      mcpServers: { ast_grep: { args: string[] }; git_bash: { args: string[] }; lsp: { args: string[] } }
    }
    expect(mcpManifest.mcpServers.ast_grep.args[0]).toBe(join(pluginPath ?? "", "components", "ast-grep-mcp", "dist", "cli.js"))
    expect((await stat(mcpManifest.mcpServers.ast_grep.args[0] ?? "")).isFile()).toBe(true)
    expect(mcpManifest.mcpServers.git_bash.args[0]).toBe(join(pluginPath ?? "", "components", "git-bash-mcp", "dist", "cli.js"))
    expect((await stat(mcpManifest.mcpServers.git_bash.args[0] ?? "")).isFile()).toBe(true)
    expect(mcpManifest.mcpServers.lsp.args[0]).toBe(join(pluginPath ?? "", "components", "lsp-tools-mcp", "dist", "cli.js"))
    expect(mcpManifest.mcpServers.lsp.args[0]).not.toContain("components/lsp/packages")
    expect(mcpManifest.mcpServers.lsp.args[0]?.startsWith(pluginPath ?? "")).toBe(true)
    expect((await stat(mcpManifest.mcpServers.lsp.args[0] ?? "")).isFile()).toBe(true)
    for (const agentName of ["codex-ultrawork-reviewer", "explorer", "librarian", "metis", "momus", "plan"]) {
      expect((await stat(join(codexHome, "agents", `${agentName}.toml`))).isFile()).toBe(true)
    }
    const marketplace = JSON.parse(
      await readFile(join(codexHome, "plugins", "cache", "sisyphuslabs", ".agents", "plugins", "marketplace.json"), "utf8"),
    ) as { plugins: Array<{ name: string; source: { source: string; path: string } }> }
    expect(marketplace.plugins).toEqual([{ name: "omo", source: { source: "local", path: "./omo/0.1.0" } }])
    let legacyCacheMissing = false
    try {
      await stat(join(codexHome, "plugins", "cache", "code-yeongyu-codex-plugins", "omo"))
    } catch (error) {
      legacyCacheMissing = error instanceof Error
    }
    expect(legacyCacheMissing).toBe(true)
  })

  test("#given simulated Windows Codex install #when installing omo #then enables git_bash MCP and trusts shell hooks", async () => {
    // given
    const codexHome = await mkdtemp(join(tmpdir(), "omo-codex-home-git-bash-win-"))
    const binDir = await mkdtemp(join(tmpdir(), "omo-codex-bin-git-bash-win-"))
    const repoRoot = process.cwd()

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
  })

  test("#given simulated Linux Codex install #when installing omo #then keeps git_bash manifest but disables policy exposure", async () => {
    // given
    const codexHome = await mkdtemp(join(tmpdir(), "omo-codex-home-git-bash-linux-"))
    const binDir = await mkdtemp(join(tmpdir(), "omo-codex-bin-git-bash-linux-"))
    const repoRoot = process.cwd()

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
  })

  test("#given codex installer #when installing omo #then links omo-prefixed component CLIs to existing cached runtimes", async () => {
    // given
    const codexHome = await mkdtemp(join(tmpdir(), "omo-codex-home-bins-"))
    const binDir = await mkdtemp(join(tmpdir(), "omo-codex-bin-bins-"))
    const repoRoot = process.cwd()

    // when
    const result = await runCodexInstaller({ codexHome, binDir, repoRoot, runCommand: async () => undefined })

    // then
    const pluginPath = result.installed[0]?.path ?? ""
    const linkedNames = (await readdir(binDir)).sort()
    expect(linkedNames).toEqual(EXPECTED_OMO_COMPONENT_BINS.map((entry) => expectedBinName(entry.name)).sort())
    for (const entry of EXPECTED_OMO_COMPONENT_BINS) {
      const linkPath = join(binDir, expectedBinName(entry.name))
      const expectedTarget = join(pluginPath, entry.target)
      if (process.platform === "win32") {
        expect((await stat(linkPath)).isFile()).toBe(true)
        expect(await readFile(linkPath, "utf8")).toContain(expectedTarget)
      } else {
        expect(await readlink(linkPath)).toBe(expectedTarget)
      }
    }
    for (const staleName of STALE_CODEX_COMPONENT_BINS) {
      expect(linkedNames).not.toContain(staleName)
      expect(linkedNames).not.toContain(`${staleName}.cmd`)
    }
  })

  test("#given installation guide #when component binaries are documented #then docs use omo-prefixed names only", async () => {
    // given
    const installationGuide = await readFile(join(process.cwd(), "docs", "guide", "installation.md"), "utf8")

    // when
    const expectedNames = EXPECTED_OMO_COMPONENT_BINS.map((entry) => entry.name)

    // then
    for (const name of expectedNames) {
      expect(installationGuide).toContain(name)
    }
    for (const staleName of STALE_CODEX_COMPONENT_BINS) {
      expect(installationGuide).not.toContain(`~/.local/bin/${staleName}`)
      expect(installationGuide).not.toContain(`command not found: ${staleName}`)
    }
  })

})
