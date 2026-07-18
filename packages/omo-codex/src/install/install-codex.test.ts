/// <reference path="../../../../bun-test.d.ts" />
/// <reference types="bun-types" />

import { describe, expect, test } from "bun:test"
import { mkdir, mkdtemp, readdir, readFile, stat, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { findRepoRoot, findRepoRootFromImporter, resolveCodexInstallerBinDir, runCodexInstaller } from "./install-codex"
import { createRepoWithBuiltComponentBins } from "./install-codex-test-fixtures"
import { createLegacyCodexHome, liveLegacyEndpointFor, startIdleNodeProcess, startLegacyDaemonProcess, stopChild, waitForChildReady, writeLegacyVersionState } from "./lsp-daemon-reaper.test-support"

const INSTALL_CODEX_INTEGRATION_TEST_TIMEOUT_MS = process.platform === "win32" ? 60_000 : 20_000

const skipAstGrepInstall = async () => ({ kind: "skipped" as const, reason: "test" })

async function listRelativeFiles(root: string, prefix = ""): Promise<string[]> {
  const entries = await readdir(join(root, prefix), { withFileTypes: true })
  const files: string[] = []
  for (const entry of entries) {
    const relativePath = prefix.length > 0 ? join(prefix, entry.name) : entry.name
    if (entry.isDirectory()) {
      files.push(...(await listRelativeFiles(root, relativePath)))
    } else {
      files.push(relativePath.replaceAll("\\", "/"))
    }
  }
  return files.sort()
}

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
    const first = await runCodexInstaller({ codexHome, binDir, repoRoot, astGrepInstaller: skipAstGrepInstall, runCommand: async () => undefined })

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
      const installedSkillFiles = await listRelativeFiles(join(pluginPath ?? "", "skills"))
      const nestedReferenceSkillFiles = installedSkillFiles.filter((file) => file.startsWith("frontend/references/") && file.endsWith("/SKILL.md"))
      const designpowersReferenceFiles = installedSkillFiles.filter((file) =>
        /^frontend\/references\/designpowers\/vendor\/skills\/[^/]+\/reference\.md$/.test(file)
      )
      expect(installedSkillFiles).toContain("frontend/SKILL.md")
      expect(nestedReferenceSkillFiles).toEqual([])
      expect(designpowersReferenceFiles).toHaveLength(27)
    }
    expect((await stat(join(pluginPath ?? "", "components", "ultrawork", "skills", "ulw-plan"))).isDirectory()).toBe(true)
    expect((await stat(join(pluginPath ?? "", "components", "ulw-loop", "skills", "ulw-loop"))).isDirectory()).toBe(true)
    const mcpManifest = JSON.parse(await readFile(join(pluginPath ?? "", ".mcp.json"), "utf8")) as {
      mcpServers: { git_bash: { args: string[] }; lsp: { args: string[] } }
    }
    expect(Object.hasOwn(mcpManifest.mcpServers, "ast_grep")).toBe(false)
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

  test("#given codex installer #when installing omo #then seeds OMO SOT through local migration script", async () => {
    // given
    const codexHome = await mkdtemp(join(tmpdir(), "omo-codex-home-sot-"))
    const binDir = await mkdtemp(join(tmpdir(), "omo-codex-bin-sot-"))
    const home = await mkdtemp(join(tmpdir(), "omo-codex-user-home-sot-"))
    const repoRoot = process.cwd()
    const invocations: Array<{ readonly command: string; readonly args: readonly string[]; readonly home: string | undefined }> = []

    // when
    await runCodexInstaller({
      codexHome,
      binDir,
      repoRoot,
      astGrepInstaller: skipAstGrepInstall,
      env: { HOME: home },
      runCommand: async (command, args, options) => {
        invocations.push({ command, args: [...args], home: options.env?.HOME })
      },
    })

    // then
    const sotInvocation = invocations.find((invocation) => invocation.args.some((arg) => arg.endsWith("migrate-omo-sot.mjs")))
    expect(sotInvocation?.command).toBe(process.execPath)
    expect(sotInvocation?.args).toContain("--seed")
    expect(sotInvocation?.home).toBe(home)
  }, { timeout: INSTALL_CODEX_INTEGRATION_TEST_TIMEOUT_MS })

  test("#given repoRoot without root CLI dist #when installing omo #then warns about the skipped omo runtime wrapper", async () => {
    // given
    const codexHome = await mkdtemp(join(tmpdir(), "omo-codex-home-no-dist-"))
    const binDir = await mkdtemp(join(tmpdir(), "omo-codex-bin-no-dist-"))
    const repoRoot = await createRepoWithBuiltComponentBins({ includeRootCliDist: false })
    const logs: string[] = []

    // when
    await runCodexInstaller({ codexHome, binDir, repoRoot, astGrepInstaller: skipAstGrepInstall, runCommand: async () => undefined, log: (line) => logs.push(line) })

    // then
    const cliPath = join(repoRoot, "dist", "cli", "index.js")
    const wrapperWarnings = logs.filter((line) => line.includes("omo runtime wrapper"))
    expect(wrapperWarnings.length).toBeGreaterThan(0)
    expect(wrapperWarnings.join("\n")).toContain(cliPath)
    const linkedNames = await readdir(binDir)
    const rootCliBinName = process.platform === "win32" ? "omo.cmd" : "omo"
    expect(linkedNames).not.toContain(rootCliBinName)
  }, { timeout: INSTALL_CODEX_INTEGRATION_TEST_TIMEOUT_MS })

  test("#given a live unverifiable legacy daemon dir #when installing omo #then it warns and does not copy legacy IPC state into the OMO home", async () => {
    // given
    const codexHome = createLegacyCodexHome("omo-codex-home-legacy-daemon-")
    const binDir = await mkdtemp(join(tmpdir(), "omo-codex-bin-legacy-daemon-"))
    const home = await mkdtemp(join(tmpdir(), "omo-codex-user-home-legacy-daemon-"))
    const endpoint = liveLegacyEndpointFor({ codexHome, version: "0.1.0" })
    const daemon = startLegacyDaemonProcess({ endpoint })
    const unrelated = startIdleNodeProcess()
    await waitForChildReady(daemon)
    const version = await writeLegacyVersionState({
      codexHome,
      version: "0.1.0",
      pid: String(unrelated.pid ?? 0),
      endpoint,
    })
    const logs: string[] = []

    try {
      // when
      await runCodexInstaller({
        codexHome,
        binDir,
        repoRoot: process.cwd(),
        astGrepInstaller: skipAstGrepInstall,
        runCommand: async () => undefined,
        env: { HOME: home },
        log: (line) => logs.push(line),
      })

      // then
      expect(logs.some((line) => line.includes("Warning: deferred legacy Codex LSP daemon cleanup for v0.1.0"))).toBe(true)
      const expectedReason = process.platform === "win32" ? "Windows cannot prove pid ownership safely" : "pid ownership was not proven"
      expect(logs.some((line) => line.includes(expectedReason))).toBe(true)
      expect((await stat(version.versionDir)).isDirectory()).toBe(true)
      await expect(stat(join(home, ".omo", "lsp-daemon"))).rejects.toThrow()
    } finally {
      await stopChild(daemon)
      await stopChild(unrelated)
    }
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
      astGrepInstaller: skipAstGrepInstall,
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
