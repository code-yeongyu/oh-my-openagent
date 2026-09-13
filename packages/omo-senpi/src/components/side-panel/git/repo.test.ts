import { afterEach, describe, expect, test } from "bun:test"
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { findGitRoot, readGitBranch } from "./repo"

const roots: string[] = []

function scratch(): string {
  const root = mkdtempSync(join(tmpdir(), "omo-panel-git-"))
  roots.push(root)
  return root
}

afterEach(() => {
  while (roots.length > 0) {
    const root = roots.pop()
    if (root !== undefined) rmSync(root, { recursive: true, force: true })
  }
})

describe("findGitRoot", () => {
  test("#given a nested directory #when searched #then the repository root is found", () => {
    // given
    const root = scratch()
    mkdirSync(join(root, ".git"))
    const nested = join(root, "packages", "deep")
    mkdirSync(nested, { recursive: true })

    // when
    const found = findGitRoot(nested)

    // then
    expect(found).toBe(root)
  })

  test("#given a directory outside any repository #when searched #then nothing is found", () => {
    // given
    const root = scratch()

    // when
    const found = findGitRoot(root)

    // then
    expect(found).toBeUndefined()
  })
})

describe("readGitBranch", () => {
  test("#given HEAD on a branch #when read #then the branch name is returned", () => {
    // given
    const root = scratch()
    mkdirSync(join(root, ".git"))
    writeFileSync(join(root, ".git", "HEAD"), "ref: refs/heads/feat/side-panel\n")

    // when
    const branch = readGitBranch(root)

    // then
    expect(branch).toBe("feat/side-panel")
  })

  test("#given a detached HEAD #when read #then a short sha stands in", () => {
    // given
    const root = scratch()
    mkdirSync(join(root, ".git"))
    writeFileSync(join(root, ".git", "HEAD"), "826d8191f0c2b3a4d5e6f70819a2b3c4d5e6f708\n")

    // when
    const branch = readGitBranch(root)

    // then
    expect(branch).toBe("826d819")
  })

  test("#given a worktree whose .git is a file #when read #then the pointer is followed", () => {
    // given
    const root = scratch()
    const real = join(root, "real-git-dir")
    mkdirSync(real)
    writeFileSync(join(real, "HEAD"), "ref: refs/heads/worktree-branch\n")
    const worktree = join(root, "wt")
    mkdirSync(worktree)
    writeFileSync(join(worktree, ".git"), `gitdir: ${real}\n`)

    // when
    const branch = readGitBranch(worktree)

    // then
    expect(branch).toBe("worktree-branch")
  })

  test("#given no repository #when read #then nothing is returned", () => {
    // given
    const root = scratch()

    // when
    const branch = readGitBranch(root)

    // then
    expect(branch).toBeUndefined()
  })
})
