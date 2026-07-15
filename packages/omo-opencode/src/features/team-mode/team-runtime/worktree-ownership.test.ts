/// <reference types="bun-types" />

import { afterEach, describe, expect, test } from "bun:test"
import { mkdtemp, mkdir, readFile, rename, rm, stat, symlink, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"

import {
  removeOwnedWorktreeDirectory,
  reserveOwnedWorktreeDirectory,
  WorktreeOwnershipConflictError,
} from "./worktree-ownership"

describe("worktree ownership", () => {
  const temporaryDirectories: string[] = []

  afterEach(async () => {
    await Promise.all(temporaryDirectories.splice(0).map(async (directory) => {
      await rm(directory, { recursive: true, force: true })
    }))
  })

  async function createRoot(prefix: string): Promise<string> {
    const root = await mkdtemp(path.join(tmpdir(), prefix))
    temporaryDirectories.push(root)
    return root
  }

  test("allows exactly one concurrent reservation for the same leaf", async () => {
    // given
    const projectRoot = await createRoot("team-owner-concurrent-")
    const memberRoot = path.join(projectRoot, "shared", "member")

    // when
    const results = await Promise.allSettled([
      reserveOwnedWorktreeDirectory(memberRoot, projectRoot),
      reserveOwnedWorktreeDirectory(memberRoot, projectRoot),
    ])

    // then
    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1)
    const rejected = results.find((result) => result.status === "rejected")
    expect(rejected?.status === "rejected" ? rejected.reason : undefined).toBeInstanceOf(WorktreeOwnershipConflictError)
  })

  test("rejects cleanup when the persisted token does not match the marker", async () => {
    // given
    const projectRoot = await createRoot("team-owner-token-")
    const reservation = await reserveOwnedWorktreeDirectory(path.join(projectRoot, "member"), projectRoot)
    if (!reservation.ownership) throw new Error("expected ownership")
    await writeFile(path.join(reservation.directory, "keep.txt"), "keep")

    // when
    const result = await removeOwnedWorktreeDirectory({
      ...reservation.ownership,
      worktreeOwnershipToken: "wrong-token",
    })

    // then
    expect(result.removed).toBe(false)
    expect(result.error).toContain("token")
    expect(await readFile(path.join(reservation.directory, "keep.txt"), "utf8")).toBe("keep")
  })

  test("refuses legacy cleanup metadata without a token marker", async () => {
    // given
    const projectRoot = await createRoot("team-owner-legacy-")
    const memberRoot = path.join(projectRoot, "member")
    await mkdir(memberRoot)
    await writeFile(path.join(memberRoot, "keep.txt"), "keep")

    // when
    const result = await removeOwnedWorktreeDirectory({ ownedWorktreeRoot: memberRoot })

    // then
    expect(result.removed).toBe(false)
    expect(result.error).toContain("metadata")
    expect(await readFile(path.join(memberRoot, "keep.txt"), "utf8")).toBe("keep")
  })

  test("refuses cleanup after the owned root is replaced by a symlink", async () => {
    // given
    const projectRoot = await createRoot("team-owner-symlink-")
    const outsideRoot = await createRoot("team-owner-outside-")
    const reservation = await reserveOwnedWorktreeDirectory(path.join(projectRoot, "member"), projectRoot)
    if (!reservation.ownership) throw new Error("expected ownership")
    await writeFile(path.join(outsideRoot, "keep.txt"), "keep")
    const displacedRoot = path.join(projectRoot, "displaced")
    await rename(reservation.directory, displacedRoot)
    await symlink(outsideRoot, reservation.directory)

    // when
    const result = await removeOwnedWorktreeDirectory(reservation.ownership)

    // then
    expect(result.removed).toBe(false)
    expect(result.error).toContain("symlink")
    expect(await readFile(path.join(outsideRoot, "keep.txt"), "utf8")).toBe("keep")
  })

  test("removes independently owned siblings without deleting their shared parent", async () => {
    // given
    const projectRoot = await createRoot("team-owner-siblings-")
    const sharedRoot = path.join(projectRoot, "shared")
    const first = await reserveOwnedWorktreeDirectory(path.join(sharedRoot, "first"), projectRoot)
    const second = await reserveOwnedWorktreeDirectory(path.join(sharedRoot, "second"), projectRoot)
    if (!first.ownership || !second.ownership) throw new Error("expected ownership")

    // when
    const firstResult = await removeOwnedWorktreeDirectory(first.ownership)
    const secondResult = await removeOwnedWorktreeDirectory(second.ownership)

    // then
    expect(firstResult.removed).toBe(true)
    expect(secondResult.removed).toBe(true)
    expect((await stat(sharedRoot)).isDirectory()).toBe(true)
  })
})
