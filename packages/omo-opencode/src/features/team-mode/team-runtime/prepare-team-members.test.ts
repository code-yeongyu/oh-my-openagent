/// <reference types="bun-types" />

import { afterEach, describe, expect, test } from "bun:test"
import { mkdir, mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"

import { resolveMemberDirectory } from "./prepare-team-members"

describe("resolveMemberDirectory", () => {
  const temporaryDirectories: string[] = []

  afterEach(async () => {
    await Promise.all(temporaryDirectories.splice(0).map(async (directory) => {
      await rm(directory, { recursive: true, force: true })
    }))
  })

  test("records the recursive mkdir root once and returns no ownership after it exists", async () => {
    // given
    const projectRoot = await mkdtemp(path.join(tmpdir(), "team-member-directory-race-"))
    temporaryDirectories.push(projectRoot)
    const ownedRoot = path.join(projectRoot, "new-root")
    const worktreePath = path.join(ownedRoot, "nested", "member")

    // when
    const firstResult = await resolveMemberDirectory(worktreePath, projectRoot)
    const secondResult = await resolveMemberDirectory(worktreePath, projectRoot)

    // then
    expect(firstResult).toEqual({ directory: worktreePath, cleanupRoot: ownedRoot })
    expect(secondResult).toEqual({ directory: worktreePath, cleanupRoot: undefined })
  })

  test("records the first child created beneath a pre-existing parent", async () => {
    // given
    const projectRoot = await mkdtemp(path.join(tmpdir(), "team-member-directory-parent-"))
    temporaryDirectories.push(projectRoot)
    const existingParent = path.join(projectRoot, "existing")
    const ownedRoot = path.join(existingParent, "new-root")
    const worktreePath = path.join(ownedRoot, "nested", "member")
    await mkdir(existingParent, { recursive: true })

    // when
    const result = await resolveMemberDirectory(worktreePath, projectRoot)

    // then
    expect(result).toEqual({ directory: worktreePath, cleanupRoot: ownedRoot })
  })

  test("records no owned root when the worktree path already exists", async () => {
    // given
    const projectRoot = await mkdtemp(path.join(tmpdir(), "team-member-directory-existing-"))
    temporaryDirectories.push(projectRoot)
    const worktreePath = path.join(projectRoot, "existing", "member")
    await mkdir(worktreePath, { recursive: true })

    // when
    const result = await resolveMemberDirectory(worktreePath, projectRoot)

    // then
    expect(result).toEqual({ directory: worktreePath, cleanupRoot: undefined })
  })
})
