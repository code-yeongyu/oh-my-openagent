/// <reference path="../../../../bun-test.d.ts" />
/// <reference types="bun-types" />

import { describe, expect, test } from "bun:test"
import { lstat, mkdir, mkdtemp, readFile, symlink, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
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
    const bootstrapDir = join(root, "bootstrap")
    const statePath = join(bootstrapDir, "state.json")
    await writeFixtureFile(statePath, "{}\n")

    // when
    const removed = await removeManagedPathBestEffort(bootstrapDir, {
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
