/// <reference types="bun-types" />

import { afterEach, beforeEach, describe, expect, it, mock } from "bun:test"
import { mkdirSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

const TEST_DIR = join(tmpdir(), `compat-discovery-no-git-${Date.now()}`)
let gitSpawns = 0
const savedGitDir = process.env.GIT_DIR

describe("findProjectOpencodeCommandDirs without a .git marker (local fix 47)", () => {
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

  it("#given a chat folder outside any repository #when finding command dirs #then never spawns git", async () => {
    delete process.env.GIT_DIR
    const { findProjectOpencodeCommandDirs } = await import("./project-discovery-dirs")

    expect(findProjectOpencodeCommandDirs(join(TEST_DIR, "chat", "session-1"))).toEqual([])
    expect(gitSpawns).toBe(0)
  })

  it("#given GIT_DIR is set #when finding command dirs for a new folder #then still asks git", async () => {
    process.env.GIT_DIR = join(TEST_DIR, "elsewhere.git")
    const { findProjectOpencodeCommandDirs } = await import("./project-discovery-dirs")

    findProjectOpencodeCommandDirs(join(TEST_DIR, "chat", "session-2-git-dir"))
    expect(gitSpawns).toBe(1)
  })
})
