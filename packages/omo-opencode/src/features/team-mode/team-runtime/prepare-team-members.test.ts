/// <reference types="bun-types" />

import { afterEach, describe, expect, test } from "bun:test"
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises"
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

  test("owns only the exact member leaf when nested ancestors are missing", async () => {
    // given
    const projectRoot = await mkdtemp(path.join(tmpdir(), "team-member-directory-race-"))
    temporaryDirectories.push(projectRoot)
    const worktreePath = path.join(projectRoot, "new-root", "nested", "member")

    // when
    const firstResult = await resolveMemberDirectory(worktreePath, projectRoot)
    const secondResult = await resolveMemberDirectory(worktreePath, projectRoot)

    // then
    expect(firstResult).toEqual({ directory: worktreePath, cleanupRoot: worktreePath })
    expect(secondResult).toEqual({ directory: worktreePath, cleanupRoot: undefined })
  })

  test("owns the exact member leaf beneath a pre-existing parent", async () => {
    // given
    const projectRoot = await mkdtemp(path.join(tmpdir(), "team-member-directory-parent-"))
    temporaryDirectories.push(projectRoot)
    const existingParent = path.join(projectRoot, "existing")
    const worktreePath = path.join(existingParent, "member")
    await mkdir(existingParent, { recursive: true })

    // when
    const result = await resolveMemberDirectory(worktreePath, projectRoot)

    // then
    expect(result).toEqual({ directory: worktreePath, cleanupRoot: worktreePath })
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

  test("rejects when the exact member leaf is an existing file", async () => {
    // given
    const projectRoot = await mkdtemp(path.join(tmpdir(), "team-member-directory-file-"))
    temporaryDirectories.push(projectRoot)
    const worktreePath = path.join(projectRoot, "member")
    await writeFile(worktreePath, "not-a-directory")

    // when
    const result = resolveMemberDirectory(worktreePath, projectRoot)

    // then
    await expect(result).rejects.toThrow()
  })

  test("concurrent sibling creation owns each exact member leaf independently", async () => {
    // given
    const projectRoot = await mkdtemp(path.join(tmpdir(), "team-member-directory-siblings-"))
    temporaryDirectories.push(projectRoot)
    const firstWorktreePath = path.join(projectRoot, "shared", "member-a")
    const secondWorktreePath = path.join(projectRoot, "shared", "member-b")

    // when
    const [firstResult, secondResult] = await Promise.all([
      resolveMemberDirectory(firstWorktreePath, projectRoot),
      resolveMemberDirectory(secondWorktreePath, projectRoot),
    ])

    // then
    expect(firstResult).toEqual({ directory: firstWorktreePath, cleanupRoot: firstWorktreePath })
    expect(secondResult).toEqual({ directory: secondWorktreePath, cleanupRoot: secondWorktreePath })
  })
})
