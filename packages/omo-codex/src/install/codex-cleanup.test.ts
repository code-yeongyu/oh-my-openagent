/// <reference path="../../../../bun-test.d.ts" />
/// <reference types="bun-types" />

import { describe, expect, test } from "bun:test"
import { lstat, mkdir, mkdtemp, readFile, symlink, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { dirname, join, parse } from "node:path"
import { COMMAND_SHIM_MARKER } from "./codex-cache-command-shim"
import { RUNTIME_WRAPPER_MARKER } from "./codex-cache-runtime-wrapper"
import { cleanupCodexLight, cleanupCodexLightConfigText, removeManagedPathBestEffort } from "./codex-cleanup"

describe("codex cleanup", () => {
  test("#given managed Codex Light state and project-local Codex leftovers #when cleanup runs #then removes only managed global state and repairs local config", async () => {
    // given
    const codexHome = await mkdtemp(join(tmpdir(), "omo-codex-cleanup-home-"))
    const projectRoot = await mkdtemp(join(tmpdir(), "omo-codex-cleanup-project-"))
    const projectDirectory = join(projectRoot, "nested")
    const configPath = join(codexHome, "config.toml")
    const projectConfigPath = join(projectRoot, ".codex", "config.toml")
    const cacheRoot = join(codexHome, "plugins", "cache", "sisyphuslabs")
    const versionPluginRoot = join(cacheRoot, "omo", "0.1.0")
    const snapshotPluginRoot = join(codexHome, ".tmp", "marketplaces", "sisyphuslabs", "plugins", "omo")
    const managedAgentPath = join(codexHome, "agents", "explorer.toml")
    const userAgentPath = join(codexHome, "agents", "custom.toml")
    const unsafeManifestAgentPath = join(projectRoot, "momus.toml")

    await mkdir(join(codexHome, "agents"), { recursive: true })
    await mkdir(versionPluginRoot, { recursive: true })
    await mkdir(snapshotPluginRoot, { recursive: true })
    await mkdir(projectDirectory, { recursive: true })
    await mkdir(join(projectRoot, ".git"), { recursive: true })
    await mkdir(join(projectRoot, ".codex"), { recursive: true })
    await writeFile(join(projectRoot, ".codex", "hooks.json"), "{}\n")
    await writeFile(managedAgentPath, "managed explorer\n")
    await writeFile(userAgentPath, "user custom\n")
    await writeFile(join(versionPluginRoot, ".installed-agents.json"), JSON.stringify({ agents: [managedAgentPath] }))
    await writeFile(
      join(snapshotPluginRoot, ".installed-agents.json"),
      JSON.stringify({ agents: [managedAgentPath, unsafeManifestAgentPath] }),
    )
    await writeFile(join(versionPluginRoot, "package.json"), "{}\n")
    await writeFile(
      configPath,
      [
        "[features]",
        "plugins = true",
        "",
        "[marketplaces.sisyphuslabs]",
        'source = "/old/cache"',
        "",
        '[plugins."omo@sisyphuslabs"]',
        "enabled = true",
        "",
        '[plugins."omo@sisyphuslabs".mcp_servers.lsp]',
        "enabled = true",
        "",
        '[hooks.state."omo@sisyphuslabs:hooks/hooks.json:post_tool_use:0:0"]',
        'trusted_hash = "sha256:old"',
        "",
        "[marketplaces.lazycodex]",
        'source = "/old/lazy"',
        "",
        '[plugins."omo@lazycodex"]',
        "enabled = true",
        "",
        "[agents.explorer]",
        'description = "managed"',
        'config_file = "./agents/explorer.toml"',
        "",
        "[agents.custom]",
        'description = "user"',
        'config_file = "./agents/custom.toml"',
        "",
      ].join("\n"),
    )
    await writeFile(
      projectConfigPath,
      [
        "[features.multi_agent_v2]",
        "enabled = true",
        "",
        "[agents]",
        "max_threads = 8",
        "max_depth = 3",
        "",
      ].join("\n"),
    )

    // when
    const result = await cleanupCodexLight({
      codexHome,
      projectDirectory,
      now: () => new Date("2026-06-01T00:00:00Z"),
    })

    // then
    expect(result.configChanged).toBe(true)
    expect(result.configBackupPath).toBe(`${configPath}.backup-2026-06-01T00-00-00-000Z`)
    expect(result.removedPaths).toContain(cacheRoot)
    expect(result.removedPaths).toContain(join(codexHome, ".tmp", "marketplaces", "sisyphuslabs"))
    expect(result.removedAgentLinks).toEqual([managedAgentPath])
    expect(result.skippedAgentLinks).toEqual([unsafeManifestAgentPath])
    expect(await pathExists(cacheRoot)).toBe(false)
    expect(await pathExists(snapshotPluginRoot)).toBe(false)
    expect(await pathExists(managedAgentPath)).toBe(false)
    expect(await pathExists(userAgentPath)).toBe(true)

    const config = await readFile(configPath, "utf8")
    expect(config).toContain("[features]")
    expect(config).not.toContain("[marketplaces.sisyphuslabs]")
    expect(config).not.toContain('omo@sisyphuslabs')
    expect(config).not.toContain("[marketplaces.lazycodex]")
    expect(config).not.toContain('omo@lazycodex')
    expect(config).not.toContain("[agents.explorer]")
    expect(config).toContain("[agents.custom]")
    expect(await readFile(result.configBackupPath ?? "", "utf8")).toContain("[marketplaces.sisyphuslabs]")

    const projectConfig = await readFile(projectConfigPath, "utf8")
    expect(result.projectCleanup.changed).toBe(true)
    expect(result.projectCleanup.artifacts.map((artifact) => artifact.relativePath).sort()).toEqual([".codex/hooks.json"])
    expect(projectConfig).not.toMatch(/^max_threads\s*=/m)
    expect(projectConfig).toContain("max_depth = 3")
    expect(await pathExists(join(projectRoot, ".codex", "hooks.json"))).toBe(true)
  })

  test("#given malformed project directory #when cleanup runs #then global cleanup still succeeds and project cleanup is skipped", async () => {
    // given
    const codexHome = await mkdtemp(join(tmpdir(), "omo-codex-cleanup-malformed-"))
    const configPath = join(codexHome, "config.toml")
    await mkdir(codexHome, { recursive: true })
    await writeFile(
      configPath,
      [
        "[marketplaces.sisyphuslabs]",
        'source = "/old/cache"',
        "",
        '[plugins."omo@sisyphuslabs"]',
        "enabled = true",
        "",
      ].join("\n"),
    )

    // when
    const result = await cleanupCodexLight({
      codexHome,
      projectDirectory: `bad\0path`,
      now: () => new Date("2026-06-01T00:00:00Z"),
    })

    // then
    expect(result.configChanged).toBe(true)
    expect(result.projectCleanup.projectRoot).toBeNull()
    expect(result.projectCleanup.configs).toEqual([])
    const config = await readFile(configPath, "utf8")
    expect(config).not.toContain("[marketplaces.sisyphuslabs]")
    expect(config).not.toContain('omo@sisyphuslabs')
  })

  test("#given managed config and missing install manifests #when cleanup runs #then removes orphaned managed agent links", async () => {
    // given
    const codexHome = await mkdtemp(join(tmpdir(), "omo-codex-cleanup-orphan-agent-"))
    const configPath = join(codexHome, "config.toml")
    const managedAgentPath = join(codexHome, "agents", "explorer.toml")
    await mkdir(join(codexHome, "agents"), { recursive: true })
    await symlink(join(codexHome, ".tmp", "marketplaces", "missing", "explorer.toml"), managedAgentPath)
    await writeFile(
      configPath,
      [
        "[marketplaces.sisyphuslabs]",
        'source = "/old/cache"',
        "",
        '[plugins."omo@sisyphuslabs"]',
        "enabled = true",
        "",
        "[agents.explorer]",
        'config_file = "./agents/explorer.toml"',
        "",
      ].join("\n"),
    )

    // when
    const result = await cleanupCodexLight({
      codexHome,
      projectDirectory: codexHome,
      now: () => new Date("2026-06-01T00:00:00Z"),
    })

    // then
    expect(result.removedAgentLinks).toEqual([managedAgentPath])
    expect(await pathExists(managedAgentPath)).toBe(false)
    const config = await readFile(configPath, "utf8")
    expect(config).not.toContain("[agents.explorer]")
  })

  test("#given project directory is a regular file #when cleanup runs #then global cleanup still succeeds and project cleanup is skipped", async () => {
    // given
    const codexHome = await mkdtemp(join(tmpdir(), "omo-codex-cleanup-file-project-home-"))
    const projectDirectory = join(await mkdtemp(join(tmpdir(), "omo-codex-cleanup-file-project-")), "project-file")
    const configPath = join(codexHome, "config.toml")
    await mkdir(codexHome, { recursive: true })
    await writeFile(projectDirectory, "not a directory\n")
    await writeFile(
      configPath,
      [
        "[marketplaces.sisyphuslabs]",
        'source = "/old/cache"',
        "",
        '[plugins."omo@sisyphuslabs"]',
        "enabled = true",
        "",
      ].join("\n"),
    )

    // when
    const result = await cleanupCodexLight({
      codexHome,
      projectDirectory,
      now: () => new Date("2026-06-01T00:00:00Z"),
    })

    // then
    expect(result.configChanged).toBe(true)
    expect(result.projectCleanup.projectRoot).toBeNull()
    expect(result.projectCleanup.configs).toEqual([])
    const config = await readFile(configPath, "utf8")
    expect(config).not.toContain("[marketplaces.sisyphuslabs]")
    expect(config).not.toContain('omo@sisyphuslabs')
  })
  test("#given provisioned runtime binaries and bootstrap plugin data #when cleanup runs #then removes only the managed subtrees", async () => {
    // given
    const codexHome = await mkdtemp(join(tmpdir(), "omo-codex-cleanup-bootstrap-"))
    const astGrepRuntimeDir = join(codexHome, "runtime", "ast-grep")
    const nodeRuntimeDir = join(codexHome, "runtime", "node")
    const foreignRuntimeFile = join(codexHome, "runtime", "other-owner", "keep.bin")
    const bootstrapDataDir = join(codexHome, "plugins", "data", "omo-sisyphuslabs", "bootstrap")
    const autoUpdateStatePath = join(codexHome, "plugins", "data", "omo-sisyphuslabs", "auto-update.json")
    const foreignBootstrapStatePath = join(codexHome, "plugins", "data", "widget-sisyphuslabs", "bootstrap", "state.json")
    const driftedBootstrapDataDir = join(codexHome, "plugins", "legacy", "omo-next-sisyphuslabs", "bootstrap")
    const cacheRoot = join(codexHome, "plugins", "cache", "sisyphuslabs")
    const snapshotRoot = join(codexHome, ".tmp", "marketplaces", "sisyphuslabs")

    await writeFixtureFile(join(astGrepRuntimeDir, "darwin-arm64", "sg"), "sg binary\n")
    await writeFixtureFile(join(nodeRuntimeDir, "node-v22.14.0-win-x64", "node.exe"), "node binary\n")
    await writeFixtureFile(foreignRuntimeFile, "other owner\n")
    await writeFixtureFile(join(bootstrapDataDir, "state.json"), JSON.stringify({ lastStatus: "success" }))
    await writeFixtureFile(join(bootstrapDataDir, "state.json.lock"), "1\n")
    await writeFixtureFile(join(bootstrapDataDir, "bootstrap.log"), "log\n")
    await writeFixtureFile(join(bootstrapDataDir, "ps-bootstrap.log"), "ps log\n")
    await writeFixtureFile(join(bootstrapDataDir, "agents-stage", ".installed-agents.json"), JSON.stringify({ agents: [] }))
    await writeFixtureFile(autoUpdateStatePath, "{}\n")
    await writeFixtureFile(foreignBootstrapStatePath, "{}\n")
    await writeFixtureFile(join(driftedBootstrapDataDir, "state.json"), "{}\n")
    await writeFixtureFile(join(cacheRoot, "omo", "0.1.0", "package.json"), "{}\n")
    await writeFixtureFile(join(snapshotRoot, "plugins", "omo", "marketplace.json"), "{}\n")

    // when
    const result = await cleanupCodexLight({
      codexHome,
      projectDirectory: codexHome,
      now: () => new Date("2026-06-01T00:00:00Z"),
    })

    // then
    expect(result.removedPaths).toContain(astGrepRuntimeDir)
    expect(result.removedPaths).toContain(nodeRuntimeDir)
    expect(result.removedPaths).toContain(bootstrapDataDir)
    expect(result.removedPaths).toContain(driftedBootstrapDataDir)
    expect(result.removedPaths).toContain(cacheRoot)
    expect(result.removedPaths).toContain(snapshotRoot)
    expect(await pathExists(astGrepRuntimeDir)).toBe(false)
    expect(await pathExists(nodeRuntimeDir)).toBe(false)
    expect(await pathExists(bootstrapDataDir)).toBe(false)
    expect(await pathExists(driftedBootstrapDataDir)).toBe(false)
    expect(await pathExists(cacheRoot)).toBe(false)
    expect(await pathExists(snapshotRoot)).toBe(false)
    expect(await pathExists(join(codexHome, "runtime"))).toBe(true)
    expect(await pathExists(foreignRuntimeFile)).toBe(true)
    expect(await pathExists(autoUpdateStatePath)).toBe(true)
    expect(await pathExists(foreignBootstrapStatePath)).toBe(true)
    expect(await pathExists(codexHome)).toBe(true)
  })

  test("#given runtime holding only the managed subtrees #when cleanup runs #then prunes the empty runtime directory", async () => {
    // given
    const codexHome = await mkdtemp(join(tmpdir(), "omo-codex-cleanup-runtime-prune-"))
    await writeFixtureFile(join(codexHome, "runtime", "ast-grep", "darwin-arm64", "sg"), "sg binary\n")
    await writeFixtureFile(join(codexHome, "runtime", "node", "node-v22.14.0-win-x64", "node.exe"), "node binary\n")

    // when
    await cleanupCodexLight({ codexHome, projectDirectory: codexHome, now: () => new Date("2026-06-01T00:00:00Z") })

    // then
    expect(await pathExists(join(codexHome, "runtime"))).toBe(false)
    expect(await pathExists(codexHome)).toBe(true)
  })

  test("#given codex home without bootstrap or runtime artifacts #when cleanup runs #then succeeds with no removed paths", async () => {
    // given
    const codexHome = await mkdtemp(join(tmpdir(), "omo-codex-cleanup-absent-"))
    await writeFile(join(codexHome, "config.toml"), "[features]\nplugins = true\n")

    // when
    const result = await cleanupCodexLight({
      codexHome,
      projectDirectory: codexHome,
      now: () => new Date("2026-06-01T00:00:00Z"),
    })

    // then
    expect(result.removedPaths).toEqual([])
    expect(result.configChanged).toBe(false)
  })

  test("#given an artifact recreated after the first removal pass #when removeManagedPathBestEffort runs #then the retry clears it within one call", async () => {
    // given
    const root = await mkdtemp(join(tmpdir(), "omo-codex-cleanup-retry-"))
    const bootstrapDir = join(root, "plugins", "data", "omo-sisyphuslabs", "bootstrap")
    const statePath = join(bootstrapDir, "state.json")
    await writeFixtureFile(statePath, "{}\n")

    // when
    const removed = await removeManagedPathBestEffort(bootstrapDir, {
      codexHome: root,
      afterFirstAttempt: async () => {
        await writeFixtureFile(statePath, "{}\n")
      },
    })

    // then
    expect(removed).toBe(true)
    expect(await pathExists(bootstrapDir)).toBe(false)
  })

  test("#given a mid-flight worker recreates bootstrap state between uninstall runs #when cleanup runs twice #then the second pass clears it without error", async () => {
    // given
    const codexHome = await mkdtemp(join(tmpdir(), "omo-codex-cleanup-two-pass-"))
    const bootstrapDataDir = join(codexHome, "plugins", "data", "omo-sisyphuslabs", "bootstrap")
    const statePath = join(bootstrapDataDir, "state.json")
    await writeFixtureFile(statePath, "{}\n")

    // when
    const firstRun = await cleanupCodexLight({ codexHome, projectDirectory: codexHome, now: () => new Date("2026-06-01T00:00:00Z") })
    await writeFixtureFile(statePath, "{}\n")
    const secondRun = await cleanupCodexLight({ codexHome, projectDirectory: codexHome, now: () => new Date("2026-06-01T00:00:00Z") })

    // then
    expect(firstRun.removedPaths).toContain(bootstrapDataDir)
    expect(secondRun.removedPaths).toContain(bootstrapDataDir)
    expect(await pathExists(statePath)).toBe(false)
    expect(await pathExists(bootstrapDataDir)).toBe(false)
  })

  test("#given config sections shaped like the bootstrap worker setup output #when config text cleanup runs #then managed sections are removed and user sections survive", async () => {
    // given
    const config = [
      "[features]",
      "plugins = true",
      "",
      "[marketplaces.sisyphuslabs]",
      'source = "https://github.com/code-yeongyu/lazycodex.git"',
      "",
      '[plugins."omo@sisyphuslabs"]',
      "enabled = true",
      "",
      '[plugins."omo@sisyphuslabs".mcp_servers.lsp]',
      "enabled = true",
      "",
      '[hooks.state."omo@sisyphuslabs:hooks/hooks.json:session_start:0:0"]',
      'trusted_hash = "sha256:bootstrap"',
      "",
      '[hooks.state."omo@sisyphuslabs:hooks/hooks.json:post_tool_use:0:0"]',
      'trusted_hash = "sha256:comment-checker"',
      "",
      "[agents.explorer]",
      'description = "managed"',
      'config_file = "./agents/explorer.toml"',
      "",
      "[agents.custom]",
      'description = "user"',
      'config_file = "./agents/custom.toml"',
      "",
    ].join("\n")

    // when
    const cleaned = cleanupCodexLightConfigText(config)

    // then
    expect(cleaned).toContain("[features]")
    expect(cleaned).toContain("[agents.custom]")
    expect(cleaned).not.toContain("sisyphuslabs")
    expect(cleaned).not.toContain("hooks.state")
    expect(cleaned).not.toContain("[agents.explorer]")
  })

  test("#given single-quoted managed hook state table #when config text cleanup runs #then removes the managed hook state", () => {
    // given
    const config = String.raw`[features]
plugins = true

[hooks.state.'omo@sisyphuslabs:hooks/hooks.json:post_tool_use:0:0']
trusted_hash = "sha256:managed"

[hooks.state.'other@local:hooks/hooks.json:post_tool_use:0:0']
trusted_hash = "sha256:user"
`

    // when
    const cleaned = cleanupCodexLightConfigText(config)

    // then
    expect(cleaned).toContain("[features]")
    expect(cleaned).not.toContain("omo@sisyphuslabs")
    expect(cleaned).toContain("other@local")
  })

  test("#given installer-created bin links in the bin dir #when cleanup runs #then removes the managed omo bins and keeps unmanaged files", async () => {
    // given: the installer's own bin shapes - a root omo.cmd runtime wrapper and an omo-ulw-loop.cmd
    // component shim - plus an unrelated command and a user-authored omo without our markers
    const codexHome = await mkdtemp(join(tmpdir(), "omo-codex-cleanup-bins-home-"))
    const binDir = await mkdtemp(join(tmpdir(), "omo-codex-cleanup-bins-dir-"))
    await writeFile(join(codexHome, "config.toml"), "[features]\nplugins = true\n")
    const rootBin = join(binDir, "omo.cmd")
    const componentBin = join(binDir, "omo-ulw-loop.cmd")
    const userBin = join(binDir, "omo")
    const unrelatedBin = join(binDir, "unrelated.cmd")
    await writeFile(rootBin, `@echo off\r\nrem ${RUNTIME_WRAPPER_MARKER}\r\n"%BUN_BINARY%" cli %*\r\n`)
    await writeFile(componentBin, `@echo off\r\n${COMMAND_SHIM_MARKER}\r\n"%OMO_NODE_BINARY%" cli.js %*\r\n`)
    await writeFile(userBin, "#!/bin/sh\necho my own omo\n")
    await writeFile(unrelatedBin, "@echo off\r\necho unrelated tool\r\n")

    // when
    const result = await cleanupCodexLight({
      codexHome,
      binDir,
      platform: "win32",
      projectDirectory: codexHome,
      now: () => new Date("2026-06-01T00:00:00Z"),
    })

    // then: managed bins gone (the "omo still remains" symptom), unmanaged files preserved
    expect(await pathExists(rootBin)).toBe(false)
    expect(await pathExists(componentBin)).toBe(false)
    expect(await pathExists(userBin)).toBe(true)
    expect(await pathExists(unrelatedBin)).toBe(true)
    expect(result.removedBinLinks).toContain(rootBin)
    expect(result.removedBinLinks).toContain(componentBin)
  })

  test.skipIf(process.platform === "win32")(
    "#given posix component bin symlinks #when cleanup runs #then removes managed component symlinks and keeps unrelated ones",
    async () => {
      // given
      const codexHome = await mkdtemp(join(tmpdir(), "omo-codex-cleanup-bins-posix-home-"))
      const binDir = await mkdtemp(join(tmpdir(), "omo-codex-cleanup-bins-posix-dir-"))
      await writeFile(join(codexHome, "config.toml"), "[features]\nplugins = true\n")
      const managedTarget = join(
        codexHome,
        "plugins",
        "cache",
        "sisyphuslabs",
        "omo",
        "1.0.0",
        "components",
        "ulw-loop",
        "dist",
        "cli.js",
      )
      const managedSymlink = join(binDir, "omo-ulw-loop")
      const unrelatedSymlink = join(binDir, "some-other-tool")
      await symlink(managedTarget, managedSymlink)
      await symlink(join(binDir, "elsewhere.js"), unrelatedSymlink)

      // when
      const result = await cleanupCodexLight({
        codexHome,
        binDir,
        platform: "linux",
        projectDirectory: codexHome,
        now: () => new Date("2026-06-01T00:00:00Z"),
      })

      // then
      expect(result.removedBinLinks).toContain(managedSymlink)
      expect(await pathExists(managedSymlink)).toBe(false)
      expect(await pathExists(unrelatedSymlink)).toBe(true)
    },
  )

  test("#given no bin directory on disk #when cleanup runs #then reports no removed bin links and does not throw", async () => {
    // given
    const codexHome = await mkdtemp(join(tmpdir(), "omo-codex-cleanup-bins-absent-"))
    await writeFile(join(codexHome, "config.toml"), "[features]\nplugins = true\n")
    const binDir = join(codexHome, "does-not-exist", "bin")

    // when
    const result = await cleanupCodexLight({
      codexHome,
      binDir,
      projectDirectory: codexHome,
      now: () => new Date("2026-06-01T00:00:00Z"),
    })

    // then
    expect(result.removedBinLinks).toEqual([])
  })

  test("#given a codex home resolving to a filesystem root #when cleanup runs #then no bin link is scanned or removed", async () => {
    // given: a real managed wrapper in the bin dir, but a codex home at the filesystem root,
    // where resolveCodexInstallerBinDir would otherwise point at a shared system bin directory
    const binDir = await mkdtemp(join(tmpdir(), "omo-codex-cleanup-rootguard-bin-"))
    const projectDirectory = await mkdtemp(join(tmpdir(), "omo-codex-cleanup-rootguard-proj-"))
    const rootBin = join(binDir, "omo.cmd")
    await writeFile(rootBin, `@echo off\r\nrem ${RUNTIME_WRAPPER_MARKER}\r\n`)

    // when
    const result = await cleanupCodexLight({
      codexHome: parse(process.cwd()).root,
      binDir,
      platform: "win32",
      projectDirectory,
      now: () => new Date("2026-06-01T00:00:00Z"),
    })

    // then
    expect(result.removedBinLinks).toEqual([])
    expect(await pathExists(rootBin)).toBe(true)
  })

  test("#given a user copy of a generated wrapper #when cleanup runs #then only installer bin names are removed", async () => {
    // given: a backup copy still carries the generated marker, but the installer never created that name
    const codexHome = await mkdtemp(join(tmpdir(), "omo-codex-cleanup-copy-home-"))
    const binDir = await mkdtemp(join(tmpdir(), "omo-codex-cleanup-copy-bin-"))
    await writeFile(join(codexHome, "config.toml"), "[features]\nplugins = true\n")
    const wrapper = `@echo off\r\nrem ${RUNTIME_WRAPPER_MARKER}\r\n`
    const managedBin = join(binDir, "omo.cmd")
    const userCopy = join(binDir, "omo.backup")
    const userNamedCmd = join(binDir, "omo-mine.cmd")
    const markerlessSameName = join(binDir, "omo-lsp.cmd")
    await writeFile(managedBin, wrapper)
    await writeFile(userCopy, wrapper)
    await writeFile(userNamedCmd, wrapper)
    await writeFile(markerlessSameName, "@echo off\r\necho my own omo-lsp\r\n")

    // when
    const result = await cleanupCodexLight({
      codexHome,
      binDir,
      platform: "win32",
      projectDirectory: codexHome,
      now: () => new Date("2026-06-01T00:00:00Z"),
    })

    // then: the installer-created name goes; a copy, an unknown name, and a markerless same-name stay
    expect(result.removedBinLinks).toEqual([managedBin])
    expect(await pathExists(managedBin)).toBe(false)
    expect(await pathExists(userCopy)).toBe(true)
    expect(await pathExists(userNamedCmd)).toBe(true)
    expect(await pathExists(markerlessSameName)).toBe(true)
  })

  test("#given a user-owned bin using an installer name without the marker #when cleanup runs #then it is kept", async () => {
    // given: the most realistic collision - the user owns the root command name themselves
    const codexHome = await mkdtemp(join(tmpdir(), "omo-codex-cleanup-usermain-home-"))
    const binDir = await mkdtemp(join(tmpdir(), "omo-codex-cleanup-usermain-bin-"))
    await writeFile(join(codexHome, "config.toml"), "[features]\nplugins = true\n")
    const userRootBin = join(binDir, "omo.cmd")
    await writeFile(userRootBin, "@echo off\r\necho my own omo launcher\r\n")

    // when
    const result = await cleanupCodexLight({
      codexHome,
      binDir,
      platform: "win32",
      projectDirectory: codexHome,
      now: () => new Date("2026-06-01T00:00:00Z"),
    })

    // then
    expect(result.removedBinLinks).toEqual([])
    expect(await pathExists(userRootBin)).toBe(true)
  })

  test("#given a managed windows wrapper left on disk with different casing #when cleanup runs #then it is still removed", async () => {
    // given: Windows resolves names case-insensitively but preserves the casing an entry was
    // created with, so the installer's lowercase `omo.cmd` path can write through to a wrapper
    // that stays on disk as `OMO.CMD`. Uninstall must still recognize it as its own.
    const codexHome = await mkdtemp(join(tmpdir(), "omo-codex-cleanup-case-home-"))
    const binDir = await mkdtemp(join(tmpdir(), "omo-codex-cleanup-case-bin-"))
    await writeFile(join(codexHome, "config.toml"), "[features]\nplugins = true\n")
    const uppercaseBin = join(binDir, "OMO.CMD")
    await writeFile(uppercaseBin, `@echo off\r\nrem ${RUNTIME_WRAPPER_MARKER}\r\n`)

    // when
    const result = await cleanupCodexLight({
      codexHome,
      binDir,
      platform: "win32",
      projectDirectory: codexHome,
      now: () => new Date("2026-06-01T00:00:00Z"),
    })

    // then
    expect(result.removedBinLinks).toEqual([uppercaseBin])
    expect(await pathExists(uppercaseBin)).toBe(false)
  })

  test("#given a user-owned windows bin using an installer name in different casing #when cleanup runs #then it is kept", async () => {
    // given: case-insensitive matching must not widen ownership - without the marker the file
    // is the user's, whatever its casing
    const codexHome = await mkdtemp(join(tmpdir(), "omo-codex-cleanup-caseuser-home-"))
    const binDir = await mkdtemp(join(tmpdir(), "omo-codex-cleanup-caseuser-bin-"))
    await writeFile(join(codexHome, "config.toml"), "[features]\nplugins = true\n")
    const userBin = join(binDir, "Omo.Cmd")
    await writeFile(userBin, "@echo off\r\necho my own omo launcher\r\n")

    // when
    const result = await cleanupCodexLight({
      codexHome,
      binDir,
      platform: "win32",
      projectDirectory: codexHome,
      now: () => new Date("2026-06-01T00:00:00Z"),
    })

    // then
    expect(result.removedBinLinks).toEqual([])
    expect(await pathExists(userBin)).toBe(true)
  })

  test("#given an install that used a one-shot CODEX_LOCAL_BIN_DIR #when uninstall runs without that variable #then the wrapper in the recorded dir is still removed", async () => {
    // given: install put the bins in a custom dir via a one-shot env override. Uninstall runs
    // later without it, so recomputing the default would sweep the wrong directory and strand
    // the command on PATH. The install-time location is recorded next to the plugin cache.
    const codexHome = await mkdtemp(join(tmpdir(), "omo-codex-cleanup-binmanifest-home-"))
    const customBinDir = await mkdtemp(join(tmpdir(), "omo-codex-cleanup-binmanifest-bin-"))
    await writeFile(join(codexHome, "config.toml"), "[features]\nplugins = true\n")
    const pluginRoot = join(codexHome, "plugins", "cache", "sisyphuslabs", "omo", "1.0.0")
    await mkdir(pluginRoot, { recursive: true })
    await writeFile(join(pluginRoot, ".installed-bin-dir.json"), JSON.stringify({ binDir: customBinDir }))
    const managedBin = join(customBinDir, "omo")
    await writeFile(managedBin, `#!/bin/sh\n# ${RUNTIME_WRAPPER_MARKER}\n`)

    // when: no binDir argument and no CODEX_LOCAL_BIN_DIR in the environment
    const result = await cleanupCodexLight({
      codexHome,
      platform: "linux",
      projectDirectory: codexHome,
      env: {},
      now: () => new Date("2026-06-01T00:00:00Z"),
    })

    // then
    expect(result.removedBinLinks).toEqual([managedBin])
    expect(await pathExists(managedBin)).toBe(false)
  })

  test("#given a recorded install bin dir and an explicit CODEX_LOCAL_BIN_DIR at uninstall #when cleanup runs #then the environment override wins", async () => {
    // given: an explicit override at uninstall time is a deliberate instruction and must not be
    // overruled by the recorded location
    const codexHome = await mkdtemp(join(tmpdir(), "omo-codex-cleanup-binprec-home-"))
    const recordedBinDir = await mkdtemp(join(tmpdir(), "omo-codex-cleanup-binprec-recorded-"))
    const overrideBinDir = await mkdtemp(join(tmpdir(), "omo-codex-cleanup-binprec-override-"))
    await writeFile(join(codexHome, "config.toml"), "[features]\nplugins = true\n")
    const pluginRoot = join(codexHome, "plugins", "cache", "sisyphuslabs", "omo", "1.0.0")
    await mkdir(pluginRoot, { recursive: true })
    await writeFile(join(pluginRoot, ".installed-bin-dir.json"), JSON.stringify({ binDir: recordedBinDir }))
    const recordedBin = join(recordedBinDir, "omo")
    const overrideBin = join(overrideBinDir, "omo")
    await writeFile(recordedBin, `#!/bin/sh\n# ${RUNTIME_WRAPPER_MARKER}\n`)
    await writeFile(overrideBin, `#!/bin/sh\n# ${RUNTIME_WRAPPER_MARKER}\n`)

    // when
    const result = await cleanupCodexLight({
      codexHome,
      platform: "linux",
      projectDirectory: codexHome,
      env: { CODEX_LOCAL_BIN_DIR: overrideBinDir },
      now: () => new Date("2026-06-01T00:00:00Z"),
    })

    // then
    expect(result.removedBinLinks).toEqual([overrideBin])
    expect(await pathExists(overrideBin)).toBe(false)
    expect(await pathExists(recordedBin)).toBe(true)
  })

  test.skipIf(process.platform === "win32")(
    "#given a legacy install under another marketplace #when cleanup runs #then its legacy bins are still removed",
    async () => {
      // given: the legacy layout used an arbitrary marketplace segment, which the legacy
      // remover already recognizes, so uninstall must not leave those commands on PATH
      const codexHome = await mkdtemp(join(tmpdir(), "omo-codex-cleanup-legacy-home-"))
      const binDir = await mkdtemp(join(tmpdir(), "omo-codex-cleanup-legacy-bin-"))
      await writeFile(join(codexHome, "config.toml"), "[features]\nplugins = true\n")
      const legacyTarget = join(
        codexHome,
        "plugins",
        "cache",
        "othermarketplace",
        "omo",
        "0.9.0",
        "components",
        "lsp",
        "dist",
        "cli.js",
      )
      const legacyBin = join(binDir, "codex-lsp")
      const userBin = join(binDir, "mytool")
      await symlink(legacyTarget, legacyBin)
      await symlink(legacyTarget, userBin)

      // when
      const result = await cleanupCodexLight({
        codexHome,
        binDir,
        platform: "linux",
        projectDirectory: codexHome,
        now: () => new Date("2026-06-01T00:00:00Z"),
      })

      // then
      expect(result.removedBinLinks).toEqual([legacyBin])
      expect(await pathExists(legacyBin)).toBe(false)
      expect(await pathExists(userBin)).toBe(true)
    },
  )

  test.skipIf(process.platform === "win32")(
    "#given a user symlink whose target resembles a managed component #when cleanup runs #then it is kept",
    async () => {
      // given
      const codexHome = await mkdtemp(join(tmpdir(), "omo-codex-cleanup-usersym-home-"))
      const binDir = await mkdtemp(join(tmpdir(), "omo-codex-cleanup-usersym-bin-"))
      await writeFile(join(codexHome, "config.toml"), "[features]\nplugins = true\n")
      const managedTarget = join(
        codexHome,
        "plugins",
        "cache",
        "sisyphuslabs",
        "omo",
        "1.0.0",
        "components",
        "lsp",
        "dist",
        "cli.js",
      )
      const managedSymlink = join(binDir, "omo-lsp")
      const userSymlink = join(binDir, "mytool")
      await symlink(managedTarget, managedSymlink)
      await symlink(managedTarget, userSymlink)

      // when
      const result = await cleanupCodexLight({
        codexHome,
        binDir,
        platform: "linux",
        projectDirectory: codexHome,
        now: () => new Date("2026-06-01T00:00:00Z"),
      })

      // then
      expect(result.removedBinLinks).toEqual([managedSymlink])
      expect(await pathExists(managedSymlink)).toBe(false)
      expect(await pathExists(userSymlink)).toBe(true)
    },
  )
})

async function writeFixtureFile(path: string, contents: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true })
  await writeFile(path, contents)
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await lstat(path)
    return true
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") return false
    throw error
  }
}
