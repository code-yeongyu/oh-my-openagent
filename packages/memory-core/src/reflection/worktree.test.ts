import { afterEach, describe, expect, it, setDefaultTimeout } from "bun:test"
import { existsSync, realpathSync } from "node:fs"
import { mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { GitMemoryRepo, createNodeGitExec } from "../git"
import {
  createReflectionWorktree,
  discardReflectionWorktree,
  finalizeReflectionWorktree,
  type ReflectionWorktree,
} from "./worktree"

const roots: string[] = []
const WINDOWS_INTEGRATION_TEST_TIMEOUT = process.platform === "win32" ? 20_000 : 5_000
const exec = createNodeGitExec()

setDefaultTimeout(WINDOWS_INTEGRATION_TEST_TIMEOUT)

async function fixture() {
  const root = realpathSync.native(await mkdtemp(join(tmpdir(), "reflection-worktree-")))
  roots.push(root)
  const parentDir = join(root, "memory")
  const repo = new GitMemoryRepo({ dir: parentDir, agentId: "agent-one" })
  await repo.init({ seedFiles: [{ relativePath: "memory.md", content: "base\n" }] })
  return { root, parentDir, repo, worktreesDir: join(root, "worktrees") }
}

async function commit(worktree: ReflectionWorktree, path: string, content: string, message = "reflect") {
  await writeFile(join(worktree.dir, path), content)
  const child = new GitMemoryRepo({ dir: worktree.dir, agentId: "agent-one" })
  await child.commitWrite([path], message, { agentId: "agent-one", authorName: "Reflection Agent" })
}

async function assertCleaned(worktree: ReflectionWorktree, parentDir: string) {
  expect(existsSync(worktree.dir)).toBe(false)
  const branch = await exec.run(["show-ref", "--verify", `refs/heads/${worktree.branch}`], {
    cwd: parentDir,
    timeoutMs: 30_000,
  })
  expect(branch.code).not.toBe(0)
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 })))
})

describe("reflection worktree finalization", () => {
  it("#given recorded identity before Git creation #when cleanup runs #then missing resources are idempotently confirmed absent", async () => {
    // given
    const { repo, root } = await fixture()
    const dir = join(root, "worktrees", "never-created")
    const branch = "memory/reflection-never-created"

    // when
    const cleanup = await discardReflectionWorktree(repo, dir, branch)

    // then
    expect(cleanup).toEqual({ worktreeRemoved: true, branchRemoved: true })
  })

  it("#given a precreate callback #when a worktree is created #then identity is published before Git resources exist", async () => {
    // given
    const { repo, worktreesDir } = await fixture()
    let observed: { readonly dir: string; readonly branch: string } | undefined

    // when
    const worktree = await createReflectionWorktree(repo, "prelaunch", worktreesDir, undefined, async (identity) => {
      expect(existsSync(identity.dir)).toBe(false)
      observed = identity
    })

    // then
    expect(observed).toEqual({ dir: worktree.dir, branch: worktree.branch })
    expect(existsSync(worktree.dir)).toBe(true)
  })

  it("#given a clean committed reflection #when auto-finalized #then it no-ff merges and cleans up", async () => {
    // #given
    const { repo, parentDir, worktreesDir } = await fixture()
    const worktree = await createReflectionWorktree(repo, "happy", worktreesDir)
    await commit(worktree, "learned.md", "learned\n")

    // #when
    let lockCalls = 0
    const result = await finalizeReflectionWorktree(worktree, {
      mode: "auto",
      summary: "learned facts",
      withWriterLock: async (operation) => { lockCalls += 1; return operation() },
    })

    // #then
    expect(result.status).toBe("merged")
    expect(result.cleanup).toEqual({ worktreeRemoved: true, branchRemoved: true })
    expect(lockCalls).toBe(1)
    expect(await repo.show("HEAD", "learned.md")).toBe("learned\n")
    expect((await exec.run(["log", "-1", "--format=%s"], { cwd: parentDir, timeoutMs: 30_000 })).stdout.trim())
      .toBe("merge(reflection): learned facts")
    await assertCleaned(worktree, parentDir)
  })

  it("#given a document-maintenance allowlist #when the child changes another path #then nothing is merged", async () => {
    // #given
    const { repo, parentDir, worktreesDir } = await fixture()
    const worktree = await createReflectionWorktree(repo, "targeted", worktreesDir)
    await commit(worktree, "reference-style.md", "target\n")
    await commit(worktree, "unrelated.md", "unrelated\n")

    // #when
    let lockCalls = 0
    const result = await finalizeReflectionWorktree(worktree, {
      mode: "auto",
      summary: "targeted dream",
      allowedPaths: ["reference-style.md"],
      withWriterLock: async (operation) => { lockCalls += 1; return operation() },
    })

    // #then
    expect(result.status).toBe("failed")
    expect(lockCalls).toBe(0)
    expect(await repo.lsTree()).toEqual(["memory.md"])
    await assertCleaned(worktree, parentDir)
  })

  it("#given a reflection with no commits #when finalized #then it reports no_changes and cleans up", async () => {
    // #given
    const { repo, parentDir, worktreesDir } = await fixture()
    const worktree = await createReflectionWorktree(repo, "empty", worktreesDir)

    // #when
    const result = await finalizeReflectionWorktree(worktree, {
      mode: "auto",
      summary: "nothing",
      withWriterLock: async (operation) => operation(),
    })

    // #then
    expect(result.status).toBe("no_changes")
    expect(result.cleanup).toEqual({ worktreeRemoved: true, branchRemoved: true })
    await assertCleaned(worktree, parentDir)
  })

  it("#given conflicting child and parent commits #when auto-finalized #then merge aborts cleanly and cleanup always runs", async () => {
    // #given
    const { repo, parentDir, worktreesDir } = await fixture()
    const worktree = await createReflectionWorktree(repo, "conflict", worktreesDir)
    await commit(worktree, "memory.md", "child\n")
    await writeFile(join(parentDir, "memory.md"), "parent\n")
    await repo.commitWrite(["memory.md"], "parent advance", { agentId: "agent-one", authorName: "Parent" })

    // #when
    const result = await finalizeReflectionWorktree(worktree, {
      mode: "auto",
      summary: "conflicting facts",
      withWriterLock: async (operation) => operation(),
    })

    // #then
    expect(result.status).toBe("merge_conflict")
    expect(await repo.status()).toBe("")
    expect((await exec.run(["rev-parse", "-q", "--verify", "MERGE_HEAD"], { cwd: parentDir, timeoutMs: 30_000 })).code).toBe(1)
    await assertCleaned(worktree, parentDir)
  })

  it("#given a dirty parent #when auto-finalized #then it refuses before merge and cleans up", async () => {
    // #given
    const { repo, parentDir, worktreesDir } = await fixture()
    const worktree = await createReflectionWorktree(repo, "parent-dirty", worktreesDir)
    await commit(worktree, "learned.md", "learned\n")
    await writeFile(join(parentDir, "local.md"), "uncommitted\n")

    // #when
    const result = await finalizeReflectionWorktree(worktree, {
      mode: "auto",
      summary: "blocked",
      withWriterLock: async (operation) => operation(),
    })

    // #then
    expect(result.status).toBe("parent_dirty")
    expect(await repo.status()).toContain("?? local.md")
    await assertCleaned(worktree, parentDir)
  })

  it("#given a non-conflicting parent advance after launch #when auto-finalized #then recorded-base drift merges successfully", async () => {
    // #given
    const { repo, parentDir, worktreesDir } = await fixture()
    const worktree = await createReflectionWorktree(repo, "drift", worktreesDir)
    await commit(worktree, "child.md", "child\n")
    await writeFile(join(parentDir, "parent.md"), "parent\n")
    await repo.commitWrite(["parent.md"], "parent advance", { agentId: "agent-one", authorName: "Parent" })

    // #when
    const result = await finalizeReflectionWorktree(worktree, {
      mode: "auto",
      summary: "drift-safe",
      withWriterLock: async (operation) => operation(),
    })

    // #then
    expect(result.status).toBe("merged")
    expect(await repo.show("HEAD", "child.md")).toBe("child\n")
    expect(await repo.show("HEAD", "parent.md")).toBe("parent\n")
    await assertCleaned(worktree, parentDir)
  }, WINDOWS_INTEGRATION_TEST_TIMEOUT)

  it("#given an externally merged reflection branch #when explicit finalization verifies reachability #then it reports merged and cleans up", async () => {
    // #given
    const { repo, parentDir, worktreesDir } = await fixture()
    const worktree = await createReflectionWorktree(repo, "explicit", worktreesDir)
    await commit(worktree, "explicit.md", "integrated\n")
    await repo.merge(worktree.branch, { noFF: true, message: "manual integration" })

    // #when
    const result = await finalizeReflectionWorktree(worktree, {
      mode: "explicit",
      withWriterLock: async (operation) => operation(),
    })

    // #then
    expect(result.status).toBe("merged")
    expect(await repo.show("HEAD", "explicit.md")).toBe("integrated\n")
    await assertCleaned(worktree, parentDir)
  }, WINDOWS_INTEGRATION_TEST_TIMEOUT)
})
