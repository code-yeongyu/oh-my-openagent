/// <reference path="../../../../bun-test.d.ts" />
/// <reference types="bun-types" />

import { describe, expect, test } from "bun:test"
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { runCodexInstaller } from "./install-codex"

const resolveTestGitBash = () => ({ found: true, path: "C:\\Git\\bin\\bash.exe", source: "env" }) as const

async function createPackagedCodexRepoRoot(): Promise<string> {
  const repoRoot = await mkdtemp(join(tmpdir(), "omo-codex-project-cleanup-repo-"))
  const codexPackageRoot = join(repoRoot, "packages", "omo-codex")
  const pluginRoot = join(codexPackageRoot, "plugin")
  await writeFile(join(repoRoot, "package.json"), JSON.stringify({ name: "oh-my-openagent", version: "4.5.12" }))
  await mkdir(join(repoRoot, "dist", "cli"), { recursive: true })
  await writeFile(join(repoRoot, "dist", "cli", "index.js"), "#!/usr/bin/env node\n")
  await mkdir(join(pluginRoot, ".codex-plugin"), { recursive: true })
  await mkdir(join(pluginRoot, "dist"), { recursive: true })
  await mkdir(join(pluginRoot, "hooks"), { recursive: true })
  await writeFile(
    join(codexPackageRoot, "marketplace.json"),
    JSON.stringify({ name: "sisyphuslabs", plugins: [{ name: "omo", source: "./plugin" }] }),
  )
  await writeFile(
    join(pluginRoot, ".codex-plugin", "plugin.json"),
    JSON.stringify({ name: "omo", version: "0.1.0", hooks: "hooks/hooks.json" }),
  )
  await writeFile(
    join(pluginRoot, "package.json"),
    JSON.stringify({ name: "@sisyphuslabs/omo-codex-plugin", version: "0.1.0" }),
  )
  await writeFile(join(pluginRoot, "dist", "cli.js"), "#!/usr/bin/env node\n")
  await writeFile(join(pluginRoot, "hooks", "hooks.json"), JSON.stringify({ hooks: {} }))
  return repoRoot
}

describe("install-codex project-local cleanup", () => {
  test("#given stale project-local Codex config #when installing Codex Light #then repairs the local conflict before returning success", async () => {
    // given
    const codexHome = await mkdtemp(join(tmpdir(), "omo-codex-home-project-cleanup-"))
    const binDir = await mkdtemp(join(tmpdir(), "omo-codex-bin-project-cleanup-"))
    const projectRoot = await mkdtemp(join(tmpdir(), "omo-codex-project-cleanup-install-"))
    const projectDirectory = join(projectRoot, "nested")
    const projectConfigPath = join(projectRoot, ".codex", "config.toml")
    const repoRoot = await createPackagedCodexRepoRoot()
    await mkdir(projectDirectory, { recursive: true })
    await mkdir(join(projectRoot, ".git"), { recursive: true })
    await mkdir(join(projectRoot, ".codex"), { recursive: true })
    await writeFile(
      projectConfigPath,
      [
        "[features.multi_agent_v2]",
        "enabled = true",
        "",
        "[agents]",
        "max_threads = 12",
        "max_depth = 5",
        "",
      ].join("\n"),
    )

    // when
    const result = await runCodexInstaller({
      codexHome,
      binDir,
      repoRoot,
      projectDirectory,
      platform: "win32",
      gitBashResolver: resolveTestGitBash,
      runCommand: async () => undefined,
    })

    // then
    expect(result.projectCleanup.configPath).toBe(projectConfigPath)
    expect(result.projectCleanup.changed).toBe(true)
    expect(result.projectCleanup.removedKeys).toEqual(["max_threads"])
    expect(result.projectCleanup.configs).toHaveLength(1)
    expect(result.projectCleanup.backupPath).toBeDefined()
    const content = await readFile(projectConfigPath, "utf8")
    expect(content).not.toMatch(/^max_threads\s*=/m)
    expect(content).toContain("max_depth = 5")
    expect(content).toContain("[features.multi_agent_v2]")
    expect(await readFile(result.projectCleanup.backupPath ?? "", "utf8")).toContain("max_threads = 12")
  }, { timeout: 15_000 })

  test("#given only global CODEX_HOME config under a parent directory #when installing Codex Light #then project cleanup leaves it to the global config updater", async () => {
    // given
    const homeRoot = await mkdtemp(join(tmpdir(), "omo-codex-home-parent-cleanup-"))
    const codexHome = join(homeRoot, ".codex")
    const binDir = await mkdtemp(join(tmpdir(), "omo-codex-bin-parent-cleanup-"))
    const projectDirectory = join(homeRoot, "workspace", "nested")
    const globalConfigPath = join(codexHome, "config.toml")
    const repoRoot = await createPackagedCodexRepoRoot()
    await mkdir(projectDirectory, { recursive: true })
    await mkdir(codexHome, { recursive: true })
    await writeFile(
      globalConfigPath,
      [
        "[features.multi_agent_v2]",
        "enabled = true",
        "",
        "[agents]",
        "max_threads = 12",
        "max_depth = 5",
        "",
      ].join("\n"),
    )

    // when
    const result = await runCodexInstaller({
      codexHome,
      binDir,
      repoRoot,
      projectDirectory,
      platform: "win32",
      gitBashResolver: resolveTestGitBash,
      runCommand: async () => undefined,
    })

    // then
    expect(result.projectCleanup.configPath).toBeNull()
    expect(result.projectCleanup.changed).toBe(false)
    const content = await readFile(globalConfigPath, "utf8")
    expect(content).not.toMatch(/^max_threads\s*=/m)
    expect(content).toContain("max_depth = 5")
  }, { timeout: 30_000 })

  test("#given project cleanup hits a filesystem edge #when installing Codex Light #then install succeeds and reports skipped cleanup", async () => {
    // given
    const codexHome = await mkdtemp(join(tmpdir(), "omo-codex-home-project-edge-"))
    const binDir = await mkdtemp(join(tmpdir(), "omo-codex-bin-project-edge-"))
    const projectRoot = await mkdtemp(join(tmpdir(), "omo-codex-project-edge-"))
    const projectDirectory = join(projectRoot, "not-a-directory")
    const logs: string[] = []
    const repoRoot = await createPackagedCodexRepoRoot()
    await writeFile(projectDirectory, "file, not directory\n")

    // when
    const result = await runCodexInstaller({
      codexHome,
      binDir,
      repoRoot,
      projectDirectory,
      platform: "win32",
      gitBashResolver: resolveTestGitBash,
      runCommand: async () => undefined,
      log: (message) => logs.push(message),
    })

    // then
    expect(result.projectCleanup.projectRoot).toBeNull()
    expect(result.projectCleanup.changed).toBe(false)
    expect(logs.some((message) => message.includes("Skipped project-local Codex cleanup"))).toBe(true)
    expect(logs.some((message) => message.includes("not a directory"))).toBe(true)
    expect((await stat(join(codexHome, "config.toml"))).isFile()).toBe(true)
  }, { timeout: 15_000 })
})
