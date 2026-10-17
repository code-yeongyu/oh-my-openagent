import { afterEach, describe, expect, test, setDefaultTimeout } from "bun:test"
import { spawn } from "node:child_process"
import { randomUUID } from "node:crypto"
import { existsSync, realpathSync } from "node:fs"
import { mkdir, mkdtemp, writeFile } from "node:fs/promises"
import { hostname, tmpdir } from "node:os"
import { join } from "node:path"

import { GitMemoryRepo, type GitCommitAuthor } from "../git"
import { StrandedGitLockError } from "../git/repo-lock-sweep"
import { buildIdentityPaths } from "../identity"
import { createLockRecord, memoryWriterLockPath, withLock } from "../locks"
import { exitedWithin } from "../locks/process-liveness.test-support"
import { runMemoryTool, type MemoryToolLock } from "./memory"
import { removeTree } from "../../../../test-support/remove-tree"
import { SAME_UID_GIT_UNINSPECTABLE } from "../git/host-scan-blind.test-support"

// A holder scan answers within LSOF_ANSWER_BOUND_MS (60 s) on a loaded macOS host; the default 20 s
// test budget would cut a correct but slow answer short.
setDefaultTimeout(90_000)

// omo #10199, named regression for a field incident: a memory writer killed mid-commit right
// after updating HEAD left a 0-byte .git/HEAD.lock. Every later write staged its files, failed on
// "cannot lock ref 'HEAD'" and surfaced only as "uncommitted changes", so nine writes were
// stranded until the lock was moved aside by hand. A HEAD.lock from a writer proven dead must be
// reclaimed; otherwise the write is refused with the reason and the way out, and nothing stays
// staged.

const AUTHOR: GitCommitAuthor = { agentId: "head-lock", authorName: "Head Lock" }

const roots: string[] = []
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => removeTree(root, { maxRetries: 10, retryDelay: 200 })))
})

async function repoWithZeroByteHeadLock(writerRecord: "dead writer" | "none") {
  const root = realpathSync.native(await mkdtemp(join(tmpdir(), "memory-head-lock-")))
  roots.push(root)
  const paths = buildIdentityPaths(root, AUTHOR.agentId)
  await mkdir(paths.locks, { recursive: true })
  const repo = new GitMemoryRepo({ dir: paths.repo, agentId: AUTHOR.agentId })
  await repo.init({ authorName: AUTHOR.authorName })
  if (writerRecord === "dead writer") {
    const dead = spawn(process.execPath, ["-e", ""], { stdio: "ignore" })
    expect(await exitedWithin(dead, 5_000)).toBe(true)
    await writeFile(memoryWriterLockPath(paths.locks), JSON.stringify({
      pid: dead.pid, process_start: "unavailable", hostname: hostname(), nonce: randomUUID(),
      created_at: new Date().toISOString(), purpose: "memory-write",
    }), "utf8")
  }
  const headLock = join(paths.repo, ".git", "HEAD.lock")
  await writeFile(headLock, "", "utf8")
  const lock: MemoryToolLock = async (_domain, operation) =>
    withLock(memoryWriterLockPath(paths.locks), await createLockRecord("memory-write"), operation, { waitTimeoutMs: 5_000, retryDelayMs: 5 })
  return { repo, lock, headLock }
}

function create(setup: Awaited<ReturnType<typeof repoWithZeroByteHeadLock>>) {
  return runMemoryTool({
    repo: setup.repo,
    lock: setup.lock,
    params: { command: "create", reason: "write after the killed writer", file_path: "system/new.md", description: "Fact", file_text: "new fact", author: AUTHOR },
  })
}

function strandedLockIn(error: unknown): StrandedGitLockError | undefined {
  for (let current = error; current instanceof Error; current = current.cause) {
    if (current instanceof StrandedGitLockError) return current
  }
  return undefined
}

describe("a 0-byte HEAD.lock left by a memory writer killed mid-commit (omo #10199 field incident)", () => {
  test.skipIf(process.platform === "win32" || SAME_UID_GIT_UNINSPECTABLE)("#given the writer that left it is proven dead #when the next memory write runs #then the lock is reclaimed and the write commits", async () => {
    // #given
    const setup = await repoWithZeroByteHeadLock("dead writer")

    // #when
    const result = await create(setup)

    // #then
    expect(result.commit?.affectedPaths).toEqual(["system/new.md"])
    expect(existsSync(setup.headLock)).toBe(false)
    expect(await setup.repo.status()).toBe("")
  })

  test("#given nothing proves the writer that left it dead #when the next memory write runs #then it is refused naming HEAD.lock with the way out, and nothing stays staged", async () => {
    // #given
    const setup = await repoWithZeroByteHeadLock("none")

    // #when
    const failure = await create(setup).catch((error: unknown) => error)

    // #then
    const kept = strandedLockIn(failure)
    expect(kept?.paths).toEqual([setup.headLock])
    expect(kept?.message.split("\n")).toContain(`  /memory unlock ${setup.headLock}`)
    expect(existsSync(setup.headLock)).toBe(true)
    expect(existsSync(join(setup.repo.dir, "system", "new.md"))).toBe(false)
    expect(await setup.repo.status()).toBe("")
  })
})
