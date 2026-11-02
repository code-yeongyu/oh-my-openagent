import { afterEach, describe, expect, it, setDefaultTimeout } from "bun:test"
import { chmodSync, existsSync, realpathSync } from "node:fs"
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import { GitMemoryRepo, createNodeGitExec } from "../git"
import { disableFixtureAutoMaintenance } from "../git/test-repo-config.test-support"
import { validateCompletion } from "./completion-validation"
import { integrateValidatedReflection } from "./worktree-integration"
import { createReflectionWorktree, type ReflectionWorktree } from "./worktree"
import { removeTree } from "../../../../test-support/remove-tree"

// omo #11993: a reflection merge that stops after writing the shared index (a refused commit
// hook) while another process holds index.lock must not leave the run's tree staged in the parent.

const roots: string[] = []
const exec = createNodeGitExec()
setDefaultTimeout(process.platform === "win32" ? 20_000 : 5_000)
const unlocked = <T>(operation: () => Promise<T>) => operation()

async function parentFixture() {
  const root = realpathSync.native(await mkdtemp(join(tmpdir(), "reflection-index-restore-")))
  roots.push(root)
  const parentDir = join(root, "memory")
  const repo = new GitMemoryRepo({ dir: parentDir, agentId: "agent-one" })
  await repo.init({ seedFiles: [{ relativePath: "memory.md", content: "base\n" }] })
  disableFixtureAutoMaintenance(parentDir)
  return { root, parentDir, repo, lockPath: join(parentDir, ".git", "index.lock") }
}

type Parent = Awaited<ReturnType<typeof parentFixture>>

async function validatedRun(parent: Parent, runId: string, path: string) {
  const worktree = await createReflectionWorktree(parent.repo, runId, join(parent.root, "worktrees"))
  await writeFile(join(worktree.dir, path), "---\ndescription: learned\n---\nlearned\n")
  const child = new GitMemoryRepo({ dir: worktree.dir, agentId: "agent-one" })
  await child.commitWrite([path], "reflect", { agentId: "agent-one", authorName: "Reflection Agent" })
  const validated = await validateCompletion(worktree, worktree.baseSha, worktree.exec)
  if (validated.status !== "valid") throw new Error(`expected a valid reflection, got ${validated.status}`)
  return { worktree, validated }
}

// The parent's commit-msg hook stands in for a concurrent writer: on its first run it takes
// index.lock and refuses with git's own lock error, exactly where a merge has already staged.
async function lockOnceInCommitMsg(parent: Parent): Promise<void> {
  const hooksDir = resolve(parent.parentDir, (await git(parent.parentDir, ["rev-parse", "--git-path", "hooks"])).stdout.trim())
  await mkdir(hooksDir, { recursive: true })
  const hook = join(hooksDir, "commit-msg")
  const sentinel = join(parent.root, "commit-msg-locked-once")
  await writeFile(hook, [
    "#!/bin/sh",
    `if [ -f '${sentinel}' ]; then exit 0; fi`,
    `touch '${sentinel}' '${parent.lockPath}'`,
    `echo "fatal: Unable to create '${parent.lockPath}': File exists." >&2`,
    "exit 1",
    "",
  ].join("\n"))
  chmodSync(hook, 0o755)
}

async function git(cwd: string, argv: readonly string[]) {
  return exec.run(argv, { cwd, timeoutMs: 30_000, env: { ...process.env, GIT_TERMINAL_PROMPT: "0" } })
}

async function parentState(parentDir: string) {
  return {
    status: (await git(parentDir, ["status", "--porcelain"])).stdout.trim(),
    mergeHead: (await git(parentDir, ["rev-parse", "-q", "--verify", "MERGE_HEAD"])).code === 0,
  }
}

function integrate(worktree: ReflectionWorktree, runId: string, validated: { tipSha: string; changedPaths: readonly string[] }, sleep: (ms: number) => Promise<void>) {
  return integrateValidatedReflection(worktree, {
    mode: "auto",
    runId,
    summary: `reflect ${runId}`,
    validated,
    withWriterLock: unlocked,
    indexLockRetry: { attempts: 3, delayMs: 1, sleep },
  })
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => removeTree(root, { maxRetries: 10, retryDelay: 200 })))
})

describe("reflection integration under a held index.lock (#11993)", () => {
  it("#given the lock holder finishes during the retry wait #when integrating #then the run merges and the parent is clean", async () => {
    const parent = await parentFixture()
    const { worktree, validated } = await validatedRun(parent, "run-1", "learned.md")
    await lockOnceInCommitMsg(parent)
    let waits = 0
    // The injected wait is the clock: the concurrent holder releases the lock while we wait.
    const releaseOnWait = async () => { waits += 1; await rm(parent.lockPath, { force: true }) }

    const result = await integrate(worktree, "run-1", validated, releaseOnWait)

    expect(result).toMatchObject({ outcome: "merged" })
    expect(waits).toBeGreaterThan(0)
    expect(await parentState(parent.parentDir)).toEqual({ status: "", mergeHead: false })
    expect((await git(parent.parentDir, ["show", "-s", "--format=%B", "HEAD"])).stdout).toContain("Omo-Run: run-1")
  })

  it("#given the lock is never released #when integrating and then running the next integration #then the next run fast-forwards to the stranded tip and merges itself", async () => {
    const parent = await parentFixture()
    const first = await validatedRun(parent, "run-1", "first.md")
    const second = await validatedRun(parent, "run-2", "second.md")
    await lockOnceInCommitMsg(parent)
    let waits = 0

    const failed = await integrate(first.worktree, "run-1", first.validated, async () => { waits += 1 })

    expect(failed.outcome).toBe("failed")
    expect(failed.detail).toContain("index.lock")
    expect(waits).toBe(2)
    await rm(parent.lockPath, { force: true })

    const merged = await integrate(second.worktree, "run-2", second.validated, async () => undefined)

    expect(merged.outcome).toBe("merged")
    expect(await parentState(parent.parentDir)).toEqual({ status: "", mergeHead: false })
    expect((await git(parent.parentDir, ["merge-base", "--is-ancestor", first.validated.tipSha, "HEAD"])).code).toBe(0)
    expect(existsSync(join(parent.parentDir, "first.md")) && existsSync(join(parent.parentDir, "second.md"))).toBe(true)
  })

  it("#given a stranded run whose files were edited afterwards #when the next run integrates #then nothing is overwritten and it reports parent_dirty", async () => {
    const parent = await parentFixture()
    const first = await validatedRun(parent, "run-1", "first.md")
    const second = await validatedRun(parent, "run-2", "second.md")
    await lockOnceInCommitMsg(parent)
    await integrate(first.worktree, "run-1", first.validated, async () => undefined)
    await rm(parent.lockPath, { force: true })
    await writeFile(join(parent.parentDir, "first.md"), "someone else's edit\n")

    const result = await integrate(second.worktree, "run-2", second.validated, async () => undefined)

    expect(result.outcome).toBe("parent_dirty")
    expect(await Bun.file(join(parent.parentDir, "first.md")).text()).toBe("someone else's edit\n")
  })
})
