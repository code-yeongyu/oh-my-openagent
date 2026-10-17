/// <reference types="bun-types" />

import { afterEach, beforeEach, describe, expect, it, mock } from "bun:test"
import { mkdirSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

const TEST_DIR = join(tmpdir(), `skills-discovery-no-git-${Date.now()}`)
let gitSpawns = 0
const savedGitDir = process.env.GIT_DIR

describe("detectWorktreePath without a .git marker (local fix 47)", () => {
  beforeEach(() => {
    mkdirSync(join(TEST_DIR, "chat", "session-1"), { recursive: true })
    gitSpawns = 0
    mock.module("node:child_process", () => ({
      execFileSync: () => {
        gitSpawns += 1
        return TEST_DIR
      },
    }))
  })

  afterEach(() => {
    mock.restore()
    if (savedGitDir === undefined) delete process.env.GIT_DIR
    else process.env.GIT_DIR = savedGitDir
    rmSync(TEST_DIR, { recursive: true, force: true })
  })

  it("#given a folder with no .git in any ancestor #when detecting #then returns undefined without spawning git", async () => {
    delete process.env.GIT_DIR
    const { clearWorktreeCache, detectWorktreePath } = await import("./project-discovery-dirs")
    clearWorktreeCache()

    expect(detectWorktreePath(join(TEST_DIR, "chat", "session-1"))).toBeUndefined()
    expect(gitSpawns).toBe(0)
  })

  it("#given a .git marker in an ancestor #when detecting #then still asks git", async () => {
    delete process.env.GIT_DIR
    mkdirSync(join(TEST_DIR, ".git"), { recursive: true })
    const { clearWorktreeCache, detectWorktreePath } = await import("./project-discovery-dirs")
    clearWorktreeCache()

    detectWorktreePath(join(TEST_DIR, "chat", "session-1"))
    expect(gitSpawns).toBe(1)
  })

  it("#given GIT_DIR is set #when detecting a folder without a marker #then still asks git", async () => {
    process.env.GIT_DIR = join(TEST_DIR, "elsewhere.git")
    const { clearWorktreeCache, detectWorktreePath } = await import("./project-discovery-dirs")
    clearWorktreeCache()

    detectWorktreePath(join(TEST_DIR, "chat", "session-1"))
    expect(gitSpawns).toBe(1)
  })
})
