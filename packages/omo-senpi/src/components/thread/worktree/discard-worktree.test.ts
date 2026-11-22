import { afterEach, describe, expect, test } from "bun:test"
import { existsSync, mkdtempSync, rmSync, symlinkSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { discardWorktree } from "./discard-worktree"
import { gitRepoKit } from "./git-repo.testkit"
import { runGit } from "./thread-worktree"

const kit = gitRepoKit()
const raw: string[] = []

afterEach(() => {
  kit.cleanup()
  for (const path of raw.splice(0)) rmSync(path, { recursive: true, force: true })
})

describe("discardWorktree compares the worktree git lists by canonical path", () => {
  test("#given a locked worktree under a root spelled differently from git's own spelling #when the create is undone with removeUnregisteredFolder #then git still counts it registered, so its folder and branch stay", async () => {
    const repo = kit.repository()
    // The tmpdir as the OS hands it out (macOS /var, Windows 8.3 short names and backslashes), reached through a link:
    // a spelling git never prints, since git reports realpaths (long names, forward slashes on Windows).
    const target = mkdtempSync(join(tmpdir(), "thread-wt-spelled-"))
    raw.push(target)
    const root = join(kit.folder("thread-wt-alias-"), "root")
    symlinkSync(target, root, "junction")
    const path = join(root, "locked")
    kit.git(repo, "worktree", "add", "-q", "-b", "locked-branch", path)
    kit.git(repo, "worktree", "lock", path)

    const left = await discardWorktree({
      repository: repo,
      path,
      branch: "locked-branch",
      root,
      git: runGit,
      removeUnregisteredFolder: true,
    })

    expect(left).toMatchObject({
      kind: "error",
      error: {
        code: "partial_commit",
        details: { reason: "worktree_left_behind", left: { folder: true, branch: true } },
      },
    })
    expect(existsSync(join(path, "README.md"))).toBe(true)
    expect(kit.git(repo, "show-ref", "--verify", "refs/heads/locked-branch")).toContain("refs/heads/locked-branch")
  })
})
