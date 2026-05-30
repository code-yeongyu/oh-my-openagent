/// <reference types="bun-types" />

import { afterEach, beforeEach, describe, expect, it } from "bun:test"
import { mkdirSync, realpathSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { spawnSync } from "./bun-spawn-shim"
import { resolveGitExecutable } from "./git-executable"

const TEST_DIR = join(tmpdir(), `project-discovery-dirs-${Date.now()}`)
type ProjectDiscoveryDirsModule = typeof import("./project-discovery-dirs")

async function importFreshProjectDiscoveryDirs(): Promise<ProjectDiscoveryDirsModule> {
  return import(`./project-discovery-dirs?test=${Date.now()}-${Math.random()}`)
}

function canonicalPath(path: string): string {
  return realpathSync(path)
}

function runGit(args: string[], cwd: string): void {
  const result = spawnSync([resolveGitExecutable(), ...args], {
    cwd,
    stdout: "pipe",
    stderr: "pipe",
  })
  if (result.exitCode !== 0) {
    throw new Error(new TextDecoder().decode(result.stderr))
  }
}

describe("project-discovery-dirs", () => {
  beforeEach(() => {
    mkdirSync(TEST_DIR, { recursive: true })
  })

  afterEach(() => {
    rmSync(TEST_DIR, { recursive: true, force: true })
  })

  it("#given repeated worktree detection #when detecting twice #then reuses the cached result", async () => {
    // given
    const repositoryDir = join(TEST_DIR, "repo")
    const nestedDirectory = join(repositoryDir, "packages", "app")
    mkdirSync(nestedDirectory, { recursive: true })
    runGit(["init"], repositoryDir)

    const { clearWorktreeCache, detectWorktreePath } = await import("./project-discovery-dirs")

    clearWorktreeCache()

    // when
    const firstPath = detectWorktreePath(nestedDirectory)
    rmSync(join(repositoryDir, ".git"), { recursive: true, force: true })
    const secondPath = detectWorktreePath(nestedDirectory)
    clearWorktreeCache()
    const thirdPath = detectWorktreePath(nestedDirectory)

    // then
    expect(firstPath).toBe(canonicalPath(repositoryDir))
    expect(secondPath).toBe(firstPath)
    expect(thirdPath).toBeUndefined()
  })

  it("#given a fresh module and real git repo #when detecting a worktree #then resolves the repository root", async () => {
    // given
    const repositoryDir = join(TEST_DIR, "fresh-repo")
    const nestedDirectory = join(repositoryDir, "packages", "app")
    mkdirSync(nestedDirectory, { recursive: true })
    runGit(["init"], repositoryDir)

    const { clearWorktreeCache, detectWorktreePath } = await importFreshProjectDiscoveryDirs()
    clearWorktreeCache()

    // when
    const worktreePath = detectWorktreePath(nestedDirectory)

    // then
    expect(worktreePath).toBe(canonicalPath(repositoryDir))
  })

  it("#given nested .opencode skill directories #when finding project opencode skill dirs #then returns nearest-first with aliases", async () => {
    // given
    const projectDir = join(TEST_DIR, "project")
    const childDir = join(projectDir, "apps", "cli")
    mkdirSync(join(projectDir, ".opencode", "skill"), { recursive: true })
    mkdirSync(join(projectDir, ".opencode", "skills"), { recursive: true })
    mkdirSync(join(TEST_DIR, ".opencode", "skills"), { recursive: true })

    const { findProjectOpencodeSkillDirs } = await import("./project-discovery-dirs")

    // when
    const directories = findProjectOpencodeSkillDirs(childDir)

    // then
    expect(directories).toEqual([
      canonicalPath(join(projectDir, ".opencode", "skills")),
      canonicalPath(join(projectDir, ".opencode", "skill")),
      canonicalPath(join(TEST_DIR, ".opencode", "skills")),
    ])
  })

  it("#given nested .opencode command directories #when finding project opencode command dirs #then returns nearest-first with aliases", async () => {
    // given
    const projectDir = join(TEST_DIR, "project")
    const childDir = join(projectDir, "packages", "tool")
    mkdirSync(join(projectDir, ".opencode", "commands"), { recursive: true })
    mkdirSync(join(TEST_DIR, ".opencode", "command"), { recursive: true })

    const { findProjectOpencodeCommandDirs } = await import("./project-discovery-dirs")

    // when
    const directories = findProjectOpencodeCommandDirs(childDir)

    // then
    expect(directories).toEqual([
      canonicalPath(join(projectDir, ".opencode", "commands")),
      canonicalPath(join(TEST_DIR, ".opencode", "command")),
    ])
  })

  it("#given ancestor claude and agents skill directories #when finding project compatibility dirs #then discovers both scopes", async () => {
    // given
    const projectDir = join(TEST_DIR, "project")
    const childDir = join(projectDir, "src", "nested")
    mkdirSync(join(projectDir, ".claude", "skills"), { recursive: true })
    mkdirSync(join(TEST_DIR, ".agents", "skills"), { recursive: true })

    const { findProjectAgentsSkillDirs, findProjectClaudeSkillDirs } = await import("./project-discovery-dirs")

    // when
    const claudeDirectories = findProjectClaudeSkillDirs(childDir)
    const agentsDirectories = findProjectAgentsSkillDirs(childDir)

    // then
    expect(claudeDirectories).toEqual([canonicalPath(join(projectDir, ".claude", "skills"))])
    expect(agentsDirectories).toEqual([canonicalPath(join(TEST_DIR, ".agents", "skills"))])
  })

  it("#given a stop directory #when finding ancestor dirs #then it does not scan beyond the stop boundary", async () => {
    // given
    const projectDir = join(TEST_DIR, "project")
    const childDir = join(projectDir, "apps", "cli")
    mkdirSync(join(projectDir, ".opencode", "skills"), { recursive: true })
    mkdirSync(join(TEST_DIR, ".opencode", "skills"), { recursive: true })

    const { findProjectOpencodeSkillDirs } = await import("./project-discovery-dirs")

    // when
    const directories = findProjectOpencodeSkillDirs(childDir, projectDir)

    // then
    expect(directories).toEqual([canonicalPath(join(projectDir, ".opencode", "skills"))])
  })

  it("#given nested .opencode plugin config files #when finding plugin config files #then returns nearest-first canonical paths", async () => {
    // given
    const grandparentDir = join(TEST_DIR, "grandparent")
    const parentDir = join(grandparentDir, "parent")
    const projectDir = join(parentDir, "project")
    mkdirSync(join(grandparentDir, ".opencode"), { recursive: true })
    mkdirSync(join(parentDir, ".opencode"), { recursive: true })
    mkdirSync(join(projectDir, ".opencode"), { recursive: true })
    writeFileSync(join(grandparentDir, ".opencode", "oh-my-openagent.jsonc"), "{}")
    writeFileSync(join(parentDir, ".opencode", "oh-my-openagent.jsonc"), "{}")
    writeFileSync(join(projectDir, ".opencode", "oh-my-openagent.jsonc"), "{}")

    const { clearPluginConfigFileDetectionCache } = await import("./jsonc-parser")
    clearPluginConfigFileDetectionCache()
    const { findProjectOpencodePluginConfigFiles } = await import("./project-discovery-dirs")

    // when
    const paths = findProjectOpencodePluginConfigFiles(projectDir, TEST_DIR)

    // then
    expect(paths).toEqual([
      canonicalPath(join(projectDir, ".opencode", "oh-my-openagent.jsonc")),
      canonicalPath(join(parentDir, ".opencode", "oh-my-openagent.jsonc")),
      canonicalPath(join(grandparentDir, ".opencode", "oh-my-openagent.jsonc")),
    ])
  })

  it("#given a stop directory #when finding plugin config files #then walking halts at the stop boundary inclusive", async () => {
    // given
    const stopDir = join(TEST_DIR, "stop")
    const childDir = join(stopDir, "child")
    mkdirSync(join(TEST_DIR, ".opencode"), { recursive: true })
    mkdirSync(join(stopDir, ".opencode"), { recursive: true })
    mkdirSync(join(childDir, ".opencode"), { recursive: true })
    writeFileSync(join(TEST_DIR, ".opencode", "oh-my-openagent.jsonc"), "{}")
    writeFileSync(join(stopDir, ".opencode", "oh-my-openagent.jsonc"), "{}")
    writeFileSync(join(childDir, ".opencode", "oh-my-openagent.jsonc"), "{}")

    const { clearPluginConfigFileDetectionCache } = await import("./jsonc-parser")
    clearPluginConfigFileDetectionCache()
    const { findProjectOpencodePluginConfigFiles } = await import("./project-discovery-dirs")

    // when
    const paths = findProjectOpencodePluginConfigFiles(childDir, stopDir)

    // then
    expect(paths).toEqual([
      canonicalPath(join(childDir, ".opencode", "oh-my-openagent.jsonc")),
      canonicalPath(join(stopDir, ".opencode", "oh-my-openagent.jsonc")),
    ])
  })

  it("#given a legacy basename in an ancestor #when finding plugin config files #then detection picks up the legacy path", async () => {
    // given
    const projectDir = join(TEST_DIR, "project")
    mkdirSync(join(TEST_DIR, ".opencode"), { recursive: true })
    mkdirSync(join(projectDir, ".opencode"), { recursive: true })
    writeFileSync(join(TEST_DIR, ".opencode", "oh-my-opencode.jsonc"), "{}")
    writeFileSync(join(projectDir, ".opencode", "oh-my-openagent.jsonc"), "{}")

    const { clearPluginConfigFileDetectionCache } = await import("./jsonc-parser")
    clearPluginConfigFileDetectionCache()
    const { findProjectOpencodePluginConfigFiles } = await import("./project-discovery-dirs")

    // when
    const paths = findProjectOpencodePluginConfigFiles(projectDir, TEST_DIR)

    // then
    expect(paths).toEqual([
      canonicalPath(join(projectDir, ".opencode", "oh-my-openagent.jsonc")),
      canonicalPath(join(TEST_DIR, ".opencode", "oh-my-opencode.jsonc")),
    ])
  })

  it("#given no .opencode directories along the walk #when finding plugin config files #then returns an empty list", async () => {
    // given
    const projectDir = join(TEST_DIR, "project", "deep")
    mkdirSync(projectDir, { recursive: true })

    const { clearPluginConfigFileDetectionCache } = await import("./jsonc-parser")
    clearPluginConfigFileDetectionCache()
    const { findProjectOpencodePluginConfigFiles } = await import("./project-discovery-dirs")

    // when
    const paths = findProjectOpencodePluginConfigFiles(projectDir, TEST_DIR)

    // then
    expect(paths).toEqual([])
  })

})
