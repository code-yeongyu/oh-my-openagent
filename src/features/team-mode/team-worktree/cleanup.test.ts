/// <reference types="bun-types" />

import { afterAll, expect, test } from "bun:test"
import fs from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"

import { findOrphanWorktrees, removeWorktree } from "./cleanup"

const temporaryDirectories: string[] = []

afterAll(async () => {
  for (const directory of temporaryDirectories) {
    await fs.rm(directory, { recursive: true, force: true })
  }
})

test("given non-git directory when removeWorktree then directory is gone without raising 'not a git repository'", async () => {
  // given - a plain directory with content, NOT a git worktree.
  // This mirrors the runtime-state dir under a non-git team_mode base_dir.
  const baseDir = await fs.mkdtemp(path.join(tmpdir(), "team-worktree-non-git-"))
  temporaryDirectories.push(baseDir)
  const runtimeDir = path.join(baseDir, "runtime", "team-runid-abc")
  await fs.mkdir(runtimeDir, { recursive: true })
  await fs.writeFile(path.join(runtimeDir, "state.json"), JSON.stringify({ teamRunId: "team-runid-abc" }))

  // when
  await removeWorktree(runtimeDir)

  // then - directory removed; no thrown error from running git in a non-repo
  await expect(fs.access(runtimeDir)).rejects.toThrow()
})

test("given runtime mismatch when findOrphanWorktrees then returns orphan paths", async () => {
  // given
  const baseDir = await fs.mkdtemp(path.join(tmpdir(), "team-worktree-orphans-"))
  temporaryDirectories.push(baseDir)
  await fs.mkdir(path.join(baseDir, "worktrees", "t1", "m1"), { recursive: true })
  await fs.mkdir(path.join(baseDir, "runtime", "t1"), { recursive: true })
  await fs.writeFile(path.join(baseDir, "runtime", "t1", "state.json"), JSON.stringify({ status: "deleted" }))

  // when
  const result = await findOrphanWorktrees(baseDir, {})

  // then
  expect(result).toEqual([path.join(baseDir, "worktrees", "t1", "m1")])
})
