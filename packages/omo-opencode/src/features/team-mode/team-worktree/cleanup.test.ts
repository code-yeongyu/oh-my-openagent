/// <reference types="bun-types" />

import { afterAll, expect, test } from "bun:test"
import fs from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"

import { findOrphanWorktrees } from "./cleanup"

const temporaryDirectories: string[] = []

afterAll(async () => {
  for (const directory of temporaryDirectories) {
    await fs.rm(directory, { recursive: true, force: true })
  }
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
