import { afterEach, describe, expect, it } from "bun:test"
import { existsSync, realpathSync } from "node:fs"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import type { GitExec, GitExecOptions, GitExecResult } from "./index"
import { GitMemoryRepo, createNodeGitExec } from "./index"

const tempDirs: string[] = []

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) =>
    rm(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 }),
  ))
})

const COMMONDIR_RACE_STDERR = (repoDir: string, ghost: string): string =>
  [
    `Preparing worktree (new branch 'memory/torn')`,
    `fatal: failed to read ${repoDir}/.git/worktrees/${ghost}/commondir: Success`,
  ].join("\n")

/**
 * Simulates the cross-process `git worktree add` race from issue #6852: while one
 * process registers `.git/worktrees/<name>/`, another enumerates it, reads a
 * `commondir` that exists but is not yet written, and git aborts the whole add.
 * The aborted attempt leaves its branch behind but no worktree.
 */
class TornWorktreeAddExec implements GitExec {
  readonly inner = createNodeGitExec()
  readonly addAttempts: string[] = []
  failures: number

  constructor(
    private readonly repoDir: string,
    private readonly options: { readonly failures: number; readonly leaveBranchBehind: boolean },
  ) {
    this.failures = options.failures
  }

  async run(argv: readonly string[], gitOptions: GitExecOptions): Promise<GitExecResult> {
    const isWorktreeAdd = argv[0] === "worktree" && argv[1] === "add"
    if (!isWorktreeAdd) return this.inner.run(argv, gitOptions)
    this.addAttempts.push(argv.join(" "))
    if (this.addAttempts.length > this.failures) return this.inner.run(argv, gitOptions)
    if (this.options.leaveBranchBehind) {
      const branchIndex = argv.indexOf("-b") + 1
      const branch = argv[branchIndex]
      const startPoint = argv[argv.length - 1]
      if (branch !== undefined && startPoint !== undefined) {
        // Exactly the partial state a torn add leaves: the branch ref exists, no
        // worktree admin area and no checkout were registered.
        await this.inner.run(["branch", branch, startPoint], gitOptions)
      }
    }
    return {
      code: 128,
      stdout: "",
      stderr: COMMONDIR_RACE_STDERR(this.repoDir, "checkout-5"),
    }
  }
}

async function realGit(cwd: string, argv: readonly string[]): Promise<GitExecResult> {
  return createNodeGitExec().run(argv, {
    cwd,
    timeoutMs: 30_000,
    env: { ...process.env, GIT_TERMINAL_PROMPT: "0" },
  })
}

async function createSeededRepo(exec?: GitExec) {
  const dir = realpathSync.native(await mkdtemp(join(tmpdir(), "memory-wt-add-")))
  tempDirs.push(dir)
  const repo = new GitMemoryRepo({ dir, agentId: "agent-one", exec })
  const head = await repo.init({ seedFiles: [{ relativePath: "system/persona.md", content: "initial\n" }] })
  return { dir, repo, head }
}

describe("GitMemoryRepo torn worktree add recovery", () => {
  it("#given a torn add that lost the commondir race and left its branch #when worktreeAdd retries #then the worktree lands on the reused branch", async () => {
    // given - the verbatim #6852 failure: a concurrent registration made git abort
    // our add after the branch ref was already created
    const parent = realpathSync.native(await mkdtemp(join(tmpdir(), "memory-wt-add-parent-")))
    tempDirs.push(parent)
    const { dir, repo, head } = await createSeededRepo()
    const exec = new TornWorktreeAddExec(dir, { failures: 1, leaveBranchBehind: true })
    const tornRepo = new GitMemoryRepo({ dir, agentId: "agent-one", exec })
    const branch = "memory/torn"
    const checkout = join(parent, "checkout")

    // when
    await tornRepo.worktreeAdd(checkout, branch, head)

    // then - the retry reused the leftover branch instead of dying on it
    expect(exec.addAttempts.length).toBe(2)
    expect(exec.addAttempts[0]).toContain(" -b ")
    expect(exec.addAttempts[1]).not.toContain(" -b ")
    expect(existsSync(join(checkout, ".git"))).toBe(true)
    const checkedOutHead = await realGit(checkout, ["rev-parse", "--verify", "HEAD"])
    expect(checkedOutHead.code).toBe(0)
    expect(checkedOutHead.stdout.trim()).toBe(head)
    const branchTip = await realGit(dir, ["rev-parse", "--verify", `refs/heads/${branch}`])
    expect(branchTip.stdout.trim()).toBe(head)
  }, 30_000)

  it("#given a torn add that died before creating its branch #when worktreeAdd retries #then the retry recreates the branch with -b", async () => {
    // given - the same commondir race, but git aborted before writing the ref
    const parent = realpathSync.native(await mkdtemp(join(tmpdir(), "memory-wt-add-parent-")))
    tempDirs.push(parent)
    const { dir, head } = await createSeededRepo()
    const exec = new TornWorktreeAddExec(dir, { failures: 1, leaveBranchBehind: false })
    const tornRepo = new GitMemoryRepo({ dir, agentId: "agent-one", exec })
    const branch = "memory/torn"
    const checkout = join(parent, "checkout")

    // when
    await tornRepo.worktreeAdd(checkout, branch, head)

    // then - both attempts used -b because no branch was left behind
    expect(exec.addAttempts.length).toBe(2)
    expect(exec.addAttempts[0]).toContain(" -b ")
    expect(exec.addAttempts[1]).toContain(" -b ")
    expect(existsSync(join(checkout, ".git"))).toBe(true)
    const checkedOutHead = await realGit(checkout, ["rev-parse", "--verify", "HEAD"])
    expect(checkedOutHead.stdout.trim()).toBe(head)
  }, 30_000)

  it("#given a commondir race that never clears #when the retry budget is exhausted #then the original error surfaces loudly", async () => {
    // given - every attempt loses the race, which must fail visibly rather than
    // silently skip the writer's commit
    const parent = realpathSync.native(await mkdtemp(join(tmpdir(), "memory-wt-add-parent-")))
    tempDirs.push(parent)
    const { dir } = await createSeededRepo()
    const exec = new TornWorktreeAddExec(dir, { failures: Number.POSITIVE_INFINITY, leaveBranchBehind: false })
    const tornRepo = new GitMemoryRepo({ dir, agentId: "agent-one", exec })

    // when
    const failure = await tornRepo.worktreeAdd(join(parent, "checkout"), "memory/torn").catch(
      (error: unknown) => error,
    )

    // then - bounded attempts, and the real error is preserved
    expect(exec.addAttempts.length).toBe(5)
    expect(String(failure)).toContain("commondir")
  }, 30_000)
})
