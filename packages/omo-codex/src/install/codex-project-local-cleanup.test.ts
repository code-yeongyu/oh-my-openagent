/// <reference path="../../../../bun-test.d.ts" />
/// <reference types="bun-types" />

import { describe, expect, test } from "bun:test"
import { lstat, mkdir, mkdtemp, readFile, stat, symlink, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { repairNearestProjectLocalCodexArtifacts } from "./codex-project-local-cleanup"

describe("codex project-local cleanup", () => {
  test("#given stale project-local Codex config #when repairing from a nested directory #then removes legacy agent concurrency keys with a backup", async () => {
    // given
    const projectRoot = await mkdtemp(join(tmpdir(), "omo-codex-project-cleanup-"))
    const nestedDir = join(projectRoot, "packages", "app")
    const configPath = join(projectRoot, ".codex", "config.toml")
    await mkdir(nestedDir, { recursive: true })
    await mkdir(join(projectRoot, ".git"), { recursive: true })
    await mkdir(join(projectRoot, ".codex"), { recursive: true })
    await writeFile(
      configPath,
      [
        "[features.multi_agent_v2]",
        "enabled = true",
        "",
        "[agents]",
        "  max_threads = 8",
        "max_depth = 3",
        "job_max_runtime_seconds = 3600",
        "",
        "[agents.explorer]",
        'config_file = "./agents/explorer.toml"',
        "",
      ].join("\n"),
    )

    // when
    const result = await repairNearestProjectLocalCodexArtifacts({
      startDirectory: nestedDir,
      now: () => new Date("2026-06-01T12:34:56.789Z"),
    })

    // then
    expect(result.configPath).toBe(configPath)
    expect(result.changed).toBe(true)
    expect(result.removedKeys).toEqual(["max_threads"])
    expect(result.configs).toHaveLength(1)
    expect(result.backupPath).toBe(`${configPath}.backup-2026-06-01T12-34-56-789Z`)
    expect(await readFile(result.backupPath ?? "", "utf8")).toContain("max_threads = 8")
    const content = await readFile(configPath, "utf8")
    expect(content).toContain("[features.multi_agent_v2]")
    expect(content).toContain("enabled = true")
    expect(content).toContain("[agents]")
    expect(content).not.toMatch(/^\s*max_threads\s*=/m)
    expect(content).toContain("max_depth = 3")
    expect(content).toContain("job_max_runtime_seconds = 3600")
    expect(content).toContain("[agents.explorer]")
    expect(content).toContain('config_file = "./agents/explorer.toml"')
  })

  test("#given root and nested project-local Codex configs #when repairing from the nested directory #then repairs every config layer Codex loads", async () => {
    // given
    const projectRoot = await mkdtemp(join(tmpdir(), "omo-codex-project-layered-"))
    const nestedDir = join(projectRoot, "packages", "app")
    const rootConfigPath = join(projectRoot, ".codex", "config.toml")
    const nestedConfigPath = join(nestedDir, ".codex", "config.toml")
    await mkdir(join(projectRoot, ".git"), { recursive: true })
    await mkdir(join(projectRoot, ".codex"), { recursive: true })
    await mkdir(join(nestedDir, ".codex"), { recursive: true })
    await writeFile(join(nestedDir, ".codex", "hooks.json"), "{}\n")
    await writeFile(
      rootConfigPath,
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
    await writeFile(
      nestedConfigPath,
      [
        "[features.multi_agent_v2]",
        "enabled = true",
        "",
        "[agents]",
        "job_max_runtime_seconds = 7200",
        "",
      ].join("\n"),
    )

    // when
    const result = await repairNearestProjectLocalCodexArtifacts({
      startDirectory: nestedDir,
      now: () => new Date("2026-06-01T01:02:03.004Z"),
    })

    // then
    expect(result.projectRoot).toBe(projectRoot)
    expect(result.changed).toBe(true)
    expect(result.configPath).toBe(rootConfigPath)
    expect(result.configs.map((config) => config.configPath)).toEqual([rootConfigPath, nestedConfigPath])
    expect(result.configs.map((config) => config.changed)).toEqual([true, false])
    expect(result.backupPath).toBe(`${rootConfigPath}.backup-2026-06-01T01-02-03-004Z`)
    const rootContent = await readFile(rootConfigPath, "utf8")
    const nestedContent = await readFile(nestedConfigPath, "utf8")
    expect(rootContent).not.toMatch(/^max_threads\s*=/m)
    expect(rootContent).toContain("max_depth = 3")
    expect(nestedContent).toContain("job_max_runtime_seconds = 7200")
    expect(result.artifacts.map((artifact) => artifact.path).sort()).toEqual([
      join(nestedDir, ".codex", "hooks.json"),
    ])
  })

  test("#given project-local legacy artifacts #when repairing #then reports them without deleting user-owned paths", async () => {
    // given
    const projectRoot = await mkdtemp(join(tmpdir(), "omo-codex-project-artifacts-"))
    const configPath = join(projectRoot, ".codex", "config.toml")
    await mkdir(join(projectRoot, ".codex", "agents"), { recursive: true })
    await mkdir(join(projectRoot, ".git"), { recursive: true })
    await mkdir(join(projectRoot, ".codex", "prompts"), { recursive: true })
    await mkdir(join(projectRoot, ".codex", "skills"), { recursive: true })
    await writeFile(join(projectRoot, ".codex", "hooks.json"), "{}\n")
    await writeFile(
      configPath,
      [
        "[features]",
        "multi_agent_v2 = true",
        "",
        "[agents]",
        "max_threads = 2",
        "",
      ].join("\n"),
    )

    // when
    const result = await repairNearestProjectLocalCodexArtifacts({ startDirectory: projectRoot })

    // then
    expect(result.artifacts.map((artifact) => artifact.relativePath).sort()).toEqual([
      ".codex/agents",
      ".codex/hooks.json",
      ".codex/prompts",
      ".codex/skills",
    ])
    expect((await stat(join(projectRoot, ".codex", "hooks.json"))).isFile()).toBe(true)
    expect((await stat(join(projectRoot, ".codex", "agents"))).isDirectory()).toBe(true)
  })

  test("#given project-local config without enabled MultiAgentV2 #when repairing #then leaves legacy agent settings unchanged", async () => {
    // given
    const projectRoot = await mkdtemp(join(tmpdir(), "omo-codex-project-no-mav2-"))
    const configPath = join(projectRoot, ".codex", "config.toml")
    await mkdir(join(projectRoot, ".codex"), { recursive: true })
    await writeFile(
      configPath,
      [
        "[agents]",
        "max_threads = 4",
        "max_depth = 2",
        "",
      ].join("\n"),
    )

    // when
    const result = await repairNearestProjectLocalCodexArtifacts({ startDirectory: projectRoot })

    // then
    expect(result.changed).toBe(false)
    expect(result.backupPath).toBeUndefined()
    const content = await readFile(configPath, "utf8")
    expect(content).toContain("max_threads = 4")
    expect(content).toContain("max_depth = 2")
  })

  test("#given no project-local config and CODEX_HOME in the parent chain #when repairing #then does not treat global Codex home as project state", async () => {
    // given
    const homeRoot = await mkdtemp(join(tmpdir(), "omo-codex-project-no-local-"))
    const codexHome = join(homeRoot, ".codex")
    const projectDirectory = join(homeRoot, "workspace", "app")
    const globalConfigPath = join(codexHome, "config.toml")
    await mkdir(projectDirectory, { recursive: true })
    await mkdir(codexHome, { recursive: true })
    await writeFile(
      globalConfigPath,
      [
        "[features.multi_agent_v2]",
        "enabled = true",
        "",
        "[agents]",
        "max_threads = 99",
        "max_depth = 9",
        "",
      ].join("\n"),
    )

    // when
    const result = await repairNearestProjectLocalCodexArtifacts({
      startDirectory: projectDirectory,
      codexHome,
    })

    // then
    expect(result.configPath).toBeNull()
    expect(result.changed).toBe(false)
    const content = await readFile(globalConfigPath, "utf8")
    expect(content).toContain("max_threads = 99")
    expect(content).toContain("max_depth = 9")
  })

  test("#given project-local config is a symlink to CODEX_HOME #when repairing #then skips it without copying or mutating the target", async () => {
    if (process.platform === "win32") return

    // given
    const codexHome = await mkdtemp(join(tmpdir(), "omo-codex-project-symlink-home-"))
    const projectRoot = await mkdtemp(join(tmpdir(), "omo-codex-project-symlink-"))
    const globalConfigPath = join(codexHome, "config.toml")
    const projectConfigPath = join(projectRoot, ".codex", "config.toml")
    await mkdir(join(projectRoot, ".git"), { recursive: true })
    await mkdir(join(projectRoot, ".codex"), { recursive: true })
    await writeFile(
      globalConfigPath,
      [
        "[features.multi_agent_v2]",
        "enabled = true",
        "",
        "[agents]",
        "max_threads = 99",
        "max_depth = 9",
        "",
      ].join("\n"),
    )
    await symlink(globalConfigPath, projectConfigPath)

    // when
    const result = await repairNearestProjectLocalCodexArtifacts({
      startDirectory: projectRoot,
      codexHome,
      now: () => new Date("2026-06-01T00:00:00Z"),
    })

    // then
    expect(result.configPath).toBeNull()
    expect(result.changed).toBe(false)
    expect(await pathExists(`${projectConfigPath}.backup-2026-06-01T00-00-00-000Z`)).toBe(false)
    const content = await readFile(globalConfigPath, "utf8")
    expect(content).toContain("max_threads = 99")
    expect(content).toContain("max_depth = 9")
  })

  test("#given malformed project directory from the environment #when repairing #then skips project-local cleanup without failing install", async () => {
    // given
    const codexHome = await mkdtemp(join(tmpdir(), "omo-codex-project-malformed-env-"))

    // when
    const result = await repairNearestProjectLocalCodexArtifacts({
      startDirectory: `bad${"\0"}path`,
      codexHome,
    })

    // then
    expect(result).toEqual({
      projectRoot: null,
      configPath: null,
      changed: false,
      removedKeys: [],
      configs: [],
      artifacts: [],
    })
  })
})

async function pathExists(path: string): Promise<boolean> {
  try {
    await lstat(path)
    return true
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") return false
    throw error
  }
}
