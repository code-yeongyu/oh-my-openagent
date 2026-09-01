/// <reference types="bun-types" />

import { afterEach, beforeEach, describe, expect, it, mock } from "bun:test"
import { mkdirSync, realpathSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

const TEST_DIR = join(tmpdir(), `project-discovery-dirs-${Date.now()}`)
let worktreeSpawnCount = 0

function canonicalPath(path: string): string {
  return realpathSync.native(path)
}

describe("project-discovery-dirs", () => {
  beforeEach(() => {
    mkdirSync(TEST_DIR, { recursive: true })
  })

  afterEach(() => {
    mock.restore()
    rmSync(TEST_DIR, { recursive: true, force: true })
  })

  it("#given repeated worktree detection #when detecting twice #then reuses the cached result", async () => {
    worktreeSpawnCount = 0
    mock.module("node:child_process", () => ({
      execFileSync: () => {
        worktreeSpawnCount += 1
        return TEST_DIR
      },
    }))
    const { clearWorktreeCache, detectWorktreePath } = await import("./project-discovery-dirs")
    clearWorktreeCache()

    expect(detectWorktreePath("/some/dir")).toBe(canonicalPath(TEST_DIR))
    expect(detectWorktreePath("/some/dir")).toBe(canonicalPath(TEST_DIR))
    expect(worktreeSpawnCount).toBe(1)
  })

  it("#given nested opencode skill directories #when finding them #then aliases resolve nearest-first", async () => {
    const project = join(TEST_DIR, "project")
    const child = join(project, "apps", "cli")
    mkdirSync(join(project, ".opencode", "skill"), { recursive: true })
    mkdirSync(join(project, ".opencode", "skills"), { recursive: true })
    const { findProjectOpencodeSkillDirs } = await import("./project-discovery-dirs")

    expect(findProjectOpencodeSkillDirs(child)).toEqual([
      canonicalPath(join(project, ".opencode", "skills")),
      canonicalPath(join(project, ".opencode", "skill")),
    ])
  })

  it("#given a stop directory #when finding compatibility skills #then traversal stops at the boundary", async () => {
    const project = join(TEST_DIR, "project")
    const child = join(project, "apps", "cli")
    mkdirSync(join(project, ".claude", "skills"), { recursive: true })
    mkdirSync(join(TEST_DIR, ".claude", "skills"), { recursive: true })
    const { findProjectClaudeSkillDirs } = await import("./project-discovery-dirs")

    expect(findProjectClaudeSkillDirs(child, project)).toEqual([
      canonicalPath(join(project, ".claude", "skills")),
    ])
  })
})
