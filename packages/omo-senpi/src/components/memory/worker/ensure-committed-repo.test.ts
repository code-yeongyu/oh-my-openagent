import { afterAll, describe, expect, test } from "bun:test"
import { execFileSync } from "node:child_process"
import { existsSync, mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { GitMemoryRepo, buildIdentityPaths, createReflectionWorktree } from "@oh-my-opencode/memory-core"

import { ensureCommittedMemoryRepo } from "./ensure-committed-repo"

const roots: string[] = []
afterAll(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

function unbornRepo(): { readonly root: string; readonly paths: ReturnType<typeof buildIdentityPaths> } {
  const root = mkdtempSync(join(tmpdir(), "omo-unborn-repo-"))
  roots.push(root)
  const paths = buildIdentityPaths(root, "agent-test")
  execFileSync("git", ["init", "-b", "main", paths.repo], { stdio: "ignore" })
  return { root, paths }
}

function headOf(paths: { readonly repo: string }): string {
  return execFileSync("git", ["-C", paths.repo, "rev-parse", "HEAD"], { encoding: "utf8" }).trim()
}

describe("ensureCommittedMemoryRepo", () => {
  test("#given a repo whose git init ran but whose first commit never landed #when ensured #then it creates the initial commit the fresh path would have (#13948)", async () => {
    const { paths } = unbornRepo()
    expect(existsSync(join(paths.repo, ".git"))).toBe(true)
    // The exact state of the reported identity: .git exists, HEAD is unborn.
    expect(() => headOf(paths)).toThrow()

    const repo = await ensureCommittedMemoryRepo(paths, "agent-test")

    expect(await repo.head()).not.toBeNull()
    expect(execFileSync("git", ["-C", paths.repo, "log", "-1", "--format=%s"], { encoding: "utf8" }).trim()).toBe(
      "chore: initialize local memory",
    )
  })

  test("#given that repaired repo #when a reflection worktree is created #then it no longer fails as 'without a parent HEAD' (#13948)", async () => {
    const { root, paths } = unbornRepo()
    const repo = await ensureCommittedMemoryRepo(paths, "agent-test")
    const worktree = await createReflectionWorktree(repo, "reflection-run-1", join(root, "worktrees"))
    expect(existsSync(join(worktree.dir, ".git"))).toBe(true)
  })

  test("#given a healthy repo #when ensured #then it is left exactly as it was", async () => {
    const { paths } = unbornRepo()
    const repo = new GitMemoryRepo({ dir: paths.repo, agentId: "agent-test" })
    await repo.init({ seedFiles: [] })
    const before = await repo.head()
    const ensured = await ensureCommittedMemoryRepo(paths, "agent-test")
    expect(await ensured.head()).toBe(before)
    expect(execFileSync("git", ["-C", paths.repo, "rev-list", "--count", "HEAD"], { encoding: "utf8" }).trim()).toBe("1")
  })

  test("#given no repo at all #when ensured #then a committed repo is initialized", async () => {
    const root = mkdtempSync(join(tmpdir(), "omo-unborn-repo-"))
    roots.push(root)
    const paths = buildIdentityPaths(root, "agent-test")
    const repo = await ensureCommittedMemoryRepo(paths, "agent-test")
    expect(await repo.head()).not.toBeNull()
  })
})
