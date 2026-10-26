import { afterEach, describe, expect, setDefaultTimeout, test } from "bun:test"
import { spawn } from "node:child_process"
import { randomUUID } from "node:crypto"
import { existsSync, realpathSync } from "node:fs"
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises"
import { hostname, tmpdir } from "node:os"
import { join } from "node:path"

import { git } from "../concurrency/two-process-kit.test-support"
import { buildIdentityPaths } from "../identity"
import { acquireLock, createLockRecord, memoryWriterLockPath, releaseLock } from "../locks"
import { exitedWithin } from "../locks/process-liveness.test-support"
import { StrandedGitLockError } from "./repo-lock-sweep"
import { inspectStrandedGitLock, unlockStrandedGitLock, type UnlockScans } from "./repo-lock-unlock"

// omo #10199: a kept stranded git lock must give the user a way out. /memory unlock re-checks the
// one lock with the sweep's own gates, refuses while a live holder is visible, and removes only
// that file after confirmation. The scans are injected so the verdict logic never depends on the
// host's process table (a desktop with non-dumpable same-uid processes answers "unknown").

// Real git and real child processes: on a loaded host one case can take tens of seconds.
setDefaultTimeout(90_000)

type IdentityPaths = ReturnType<typeof buildIdentityPaths>

const roots: string[] = []
const children: ReturnType<typeof spawn>[] = []
afterEach(async () => {
  for (const child of children.splice(0)) child.kill("SIGKILL")
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

const NOBODY: UnlockScans = { findHolders: async () => [], findRepoUsers: async () => [] }

async function identity(agentId: string): Promise<IdentityPaths> {
  const root = realpathSync.native(await mkdtemp(join(tmpdir(), "memory-unlock-")))
  roots.push(root)
  const paths = buildIdentityPaths(root, agentId)
  await mkdir(paths.repo, { recursive: true })
  await mkdir(paths.locks, { recursive: true })
  await git(paths.repo, ["init", "-b", "main"])
  return paths
}

async function strand(repoDir: string, relative: string): Promise<string> {
  const lockPath = join(repoDir, ".git", relative)
  await mkdir(join(lockPath, ".."), { recursive: true })
  await writeFile(lockPath, "", "utf8")
  return lockPath
}

async function writerRecord(paths: IdentityPaths, pid: number): Promise<void> {
  await writeFile(memoryWriterLockPath(paths.locks), JSON.stringify({
    pid,
    process_start: "unavailable",
    hostname: hostname(),
    nonce: randomUUID(),
    created_at: new Date().toISOString(),
    purpose: "memory-write",
  }), "utf8")
}

describe("the kept stranded-lock error gives a way out (omo #10199)", () => {
  test("#given a kept lock #when the error renders #then it names the path, the reason in plain words and the unlock command", () => {
    // #given
    const lockPath = "/memory/agents/a/repo/.git/index.lock"

    // #when
    const message = new StrandedGitLockError([{ path: lockPath, reason: "repo-in-use" }]).message

    // #then
    expect(message).toContain(lockPath)
    expect(message).toContain("a live process is still working in the repository, or that could not be ruled out")
    expect(message).toContain(`/memory unlock ${lockPath}`)
  })
})

describe("/memory unlock re-checks one stranded git lock (omo #10199)", () => {
  test("#given a memory writer in THIS process holding the memory-write lock #when the lock is inspected and unlocked #then both refuse and the lock stays", async () => {
    // #given
    const paths = await identity("unlock-same-process-writer")
    const lockPath = await strand(paths.repo, "index.lock")
    const record = await createLockRecord("memory-write")
    await acquireLock(memoryWriterLockPath(paths.locks), record)

    try {
      // #when
      const inspection = await inspectStrandedGitLock(paths.repo, lockPath, NOBODY)
      if (inspection.kind !== "found") throw new Error(`unexpected ${inspection.kind}`)
      const outcome = await unlockStrandedGitLock(paths.repo, { ...inspection, verdict: "confirm" }, NOBODY)

      // #then
      expect(inspection.writer).toEqual({ kind: "alive", pid: process.pid })
      expect(inspection.verdict).toBe("refuse")
      expect(outcome.kind).toBe("refused")
      expect(existsSync(lockPath)).toBe(true)
    } finally {
      await releaseLock(memoryWriterLockPath(paths.locks), record)
    }
  })

  test("#given an unreadable memory-write lock record #when the lock is inspected #then the writer is reported unknown, never none", async () => {
    // #given
    const paths = await identity("unlock-unreadable-writer")
    const lockPath = await strand(paths.repo, "index.lock")
    await writeFile(memoryWriterLockPath(paths.locks), "{not json", "utf8")

    // #when
    const inspection = await inspectStrandedGitLock(paths.repo, lockPath, NOBODY)

    // #then
    expect(inspection.kind).toBe("found")
    if (inspection.kind !== "found") return
    expect(inspection.writer.kind).toBe("unknown")
    expect(inspection.verdict).toBe("refuse")
    expect(inspection.writerLockPath).toBe(memoryWriterLockPath(paths.locks))
  })

  test("#given a path that is not a git lock the sweep considers #when it is inspected #then it is rejected", async () => {
    // #given
    const paths = await identity("unlock-not-a-lock")
    const other = join(paths.repo, "notes.lock")
    await writeFile(other, "", "utf8")

    // #when
    const inspection = await inspectStrandedGitLock(paths.repo, other, NOBODY)

    // #then
    expect(inspection.kind).toBe("not-a-git-lock")
  })

  test("#given a process visibly holding the lock open #when it is inspected #then the verdict is refuse and the holder is shown", async () => {
    // #given
    const paths = await identity("unlock-holder")
    const lockPath = await strand(paths.repo, "index.lock")
    const scans: UnlockScans = { findHolders: async () => [4242], findRepoUsers: async () => [] }

    // #when
    const inspection = await inspectStrandedGitLock(paths.repo, lockPath, scans)

    // #then
    expect(inspection.kind).toBe("found")
    if (inspection.kind !== "found") return
    expect(inspection.verdict).toBe("refuse")
    expect(inspection.holders).toEqual([4242])
  })

  test("#given a live process working in the repository #when unlock runs on a confirmed inspection #then it refuses and the lock stays", async () => {
    // #given
    const paths = await identity("unlock-repo-user")
    const lockPath = await strand(paths.repo, "index.lock")
    const confirmed = await inspectStrandedGitLock(paths.repo, lockPath, NOBODY)
    if (confirmed.kind !== "found") throw new Error(`unexpected ${confirmed.kind}`)
    const nowBusy: UnlockScans = { findHolders: async () => [], findRepoUsers: async () => [5151] }

    // #when
    const outcome = await unlockStrandedGitLock(paths.repo, confirmed, nowBusy)

    // #then
    expect(outcome.kind).toBe("refused")
    expect(existsSync(lockPath)).toBe(true)
  })

  test("#given a live memory writer recorded in the writer lock #when the lock is inspected #then the verdict is refuse", async () => {
    // #given
    const paths = await identity("unlock-live-writer")
    const lockPath = await strand(paths.repo, "index.lock")
    const writer = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], { stdio: "ignore" })
    children.push(writer)
    if (writer.pid === undefined) throw new Error("writer has no pid")
    await writerRecord(paths, writer.pid)

    // #when
    const inspection = await inspectStrandedGitLock(paths.repo, lockPath, NOBODY)

    // #then
    expect(inspection.kind).toBe("found")
    if (inspection.kind !== "found") return
    expect(inspection.writer).toEqual({ kind: "alive", pid: writer.pid })
    expect(inspection.verdict).toBe("refuse")
  })

  test("#given a dead recorded writer and no visible holder #when it is inspected #then the verdict is confirm, never an automatic removal", async () => {
    // #given
    const paths = await identity("unlock-dead-writer")
    const lockPath = await strand(paths.repo, "index.lock")
    const dead = spawn(process.execPath, ["-e", ""], { stdio: "ignore" })
    expect(await exitedWithin(dead, 5_000)).toBe(true)
    if (dead.pid === undefined) throw new Error("dead child has no pid")
    await writerRecord(paths, dead.pid)

    // #when
    const inspection = await inspectStrandedGitLock(paths.repo, lockPath, NOBODY)

    // #then
    expect(inspection.kind).toBe("found")
    if (inspection.kind !== "found") return
    expect(inspection.verdict).toBe("confirm")
    expect(existsSync(lockPath)).toBe(true)
  })

  test("#given holders that could not be determined #when it is inspected #then the verdict is confirm and the unknown is reported", async () => {
    // #given
    const paths = await identity("unlock-unknown")
    const lockPath = await strand(paths.repo, "index.lock")
    const unknown: UnlockScans = { findHolders: async () => null, findRepoUsers: async () => null }

    // #when
    const inspection = await inspectStrandedGitLock(paths.repo, lockPath, unknown)

    // #then
    expect(inspection.kind).toBe("found")
    if (inspection.kind !== "found") return
    expect(inspection.verdict).toBe("confirm")
    expect(inspection.holders).toBeNull()
    expect(inspection.repoUsers).toBeNull()
  })

  test("#given two stranded locks #when unlock runs on one confirmed inspection #then only that lock is removed", async () => {
    // #given
    const paths = await identity("unlock-only-one")
    const indexLock = await strand(paths.repo, "index.lock")
    const refLock = await strand(paths.repo, join("refs", "heads", "main.lock"))
    const confirmed = await inspectStrandedGitLock(paths.repo, indexLock, NOBODY)
    if (confirmed.kind !== "found") throw new Error(`unexpected ${confirmed.kind}`)

    // #when
    const outcome = await unlockStrandedGitLock(paths.repo, confirmed, NOBODY)

    // #then
    expect(outcome.kind).toBe("removed")
    expect(existsSync(indexLock)).toBe(false)
    expect(existsSync(refLock)).toBe(true)
  })

  test("#given the lock was replaced after the confirmed inspection #when unlock runs #then it refuses as changed and the new lock stays", async () => {
    // #given
    const paths = await identity("unlock-changed")
    const lockPath = await strand(paths.repo, "index.lock")
    const confirmed = await inspectStrandedGitLock(paths.repo, lockPath, NOBODY)
    if (confirmed.kind !== "found") throw new Error(`unexpected ${confirmed.kind}`)
    await rm(lockPath)
    await writeFile(lockPath, "new writer", "utf8")

    // #when
    const outcome = await unlockStrandedGitLock(paths.repo, confirmed, NOBODY)

    // #then
    expect(outcome.kind).toBe("changed")
    expect(existsSync(lockPath)).toBe(true)
  })
})
