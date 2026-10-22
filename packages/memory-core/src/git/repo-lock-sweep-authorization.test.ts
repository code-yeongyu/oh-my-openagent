import { afterEach, describe, expect, test, setDefaultTimeout } from "bun:test"
import { spawn } from "node:child_process"
import { randomUUID } from "node:crypto"
import { existsSync, realpathSync } from "node:fs"
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises"
import { hostname, tmpdir } from "node:os"
import { join } from "node:path"

import { git } from "../concurrency/two-process-kit.test-support"
import { buildIdentityPaths } from "../identity"
import { acquireLock, createLockRecord, memoryMaintenanceLockPath, memoryWriterLockPath, releaseLock } from "../locks"
import { exitedWithin, probeUntil } from "../locks/process-liveness.test-support"
import { sweepStrandedGitLockFiles } from "./repo-lock-sweep"
import { SAME_UID_GIT_UNINSPECTABLE } from "./host-scan-blind.test-support"

// A holder scan answers within LSOF_ANSWER_BOUND_MS (60 s) on a loaded macOS host; the default 20 s
// test budget would cut a correct but slow answer short.
setDefaultTimeout(90_000)

// omo #10199 review round 5, MEDIUM 3: a dead-owner takeover authorizes reclaiming stranded git
// locks for THAT acquisition of THAT writer lock only. The proof must not outlive the acquisition
// (release, then a later ordinary acquisition) and must not leak from the directory sweep that
// reclaimed the dead owner on behalf of a different lock in the same directory.

type IdentityPaths = ReturnType<typeof buildIdentityPaths>

const roots: string[] = []
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

async function identityWithDeadWriter(agentId: string): Promise<IdentityPaths> {
  const root = realpathSync.native(await mkdtemp(join(tmpdir(), "memory-sweep-authz-")))
  roots.push(root)
  const paths = buildIdentityPaths(root, agentId)
  await mkdir(paths.repo, { recursive: true })
  await mkdir(paths.locks, { recursive: true })
  await git(paths.repo, ["init", "-b", "main"])
  const dead = spawn(process.execPath, ["-e", ""], { stdio: "ignore" })
  expect(await exitedWithin(dead, 5_000)).toBe(true)
  if (dead.pid === undefined) throw new Error("dead child has no pid")
  await writeFile(memoryWriterLockPath(paths.locks), JSON.stringify({
    pid: dead.pid,
    process_start: "unavailable",
    hostname: hostname(),
    nonce: randomUUID(),
    created_at: new Date().toISOString(),
    purpose: "memory-write",
  }), "utf8")
  return paths
}

async function strandIndexLock(repoDir: string): Promise<string> {
  const holder = spawn("git", ["-C", repoDir, "update-index", "--stdin"], { stdio: ["pipe", "ignore", "ignore"] })
  const lockPath = join(repoDir, ".git", "index.lock")
  expect(await probeUntil(() => existsSync(lockPath), 10_000)).toBe(true)
  holder.kill("SIGKILL")
  expect(await exitedWithin(holder, 5_000)).toBe(true)
  return lockPath
}

async function withWriterLock<T>(paths: IdentityPaths, run: () => Promise<T>): Promise<T> {
  const record = await createLockRecord("memory-write")
  await acquireLock(memoryWriterLockPath(paths.locks), record, { waitTimeoutMs: 5_000, retryDelayMs: 5 })
  try {
    return await run()
  } finally {
    await releaseLock(memoryWriterLockPath(paths.locks), record)
  }
}

describe("the dead-owner reclaim authorization is scoped to one acquisition of one lock (omo #10199 r5 MEDIUM 3)", () => {
  test.skipIf(process.platform === "win32")("#given a takeover acquisition that was released #when a LATER ordinary acquisition sweeps #then the stranded lock is kept", async () => {
    // #given
    const paths = await identityWithDeadWriter("authz-released")
    await withWriterLock(paths, async () => undefined)
    const lockPath = await strandIndexLock(paths.repo)

    // #when
    const report = await withWriterLock(paths, () => sweepStrandedGitLockFiles(paths.repo, 50))

    // #then
    expect(report.removed).toEqual([])
    expect(existsSync(lockPath)).toBe(true)
  }, 30_000)

  test.skipIf(process.platform === "win32")("#given the dead writer reclaimed by the directory sweep of ANOTHER lock's acquisition #when the writer lock is then acquired and sweeps #then the stranded lock is kept", async () => {
    // #given: acquiring the maintenance lock runs the directory hygiene, which reclaims the dead
    // writer lock with a throwaway record. That proof belongs to no writer acquisition.
    const paths = await identityWithDeadWriter("authz-other-lock")
    const maintenance = await createLockRecord("memory-maintenance")
    await acquireLock(memoryMaintenanceLockPath(paths.locks), maintenance, { waitTimeoutMs: 5_000, retryDelayMs: 5 })
    await releaseLock(memoryMaintenanceLockPath(paths.locks), maintenance)
    const lockPath = await strandIndexLock(paths.repo)

    // #when
    const report = await withWriterLock(paths, () => sweepStrandedGitLockFiles(paths.repo, 50))

    // #then
    expect(report.removed).toEqual([])
    expect(existsSync(lockPath)).toBe(true)
  }, 30_000)

  test.skipIf(process.platform === "win32" || SAME_UID_GIT_UNINSPECTABLE)("#given a takeover of identity A's writer lock held #when identity B's repo is swept under B's ordinary acquisition #then B's stranded lock is kept and A's is reclaimed", async () => {
    // #given
    const a = await identityWithDeadWriter("authz-a")
    const root = realpathSync.native(await mkdtemp(join(tmpdir(), "memory-sweep-authz-b-")))
    roots.push(root)
    const b = buildIdentityPaths(root, "authz-b")
    await mkdir(b.repo, { recursive: true })
    await mkdir(b.locks, { recursive: true })
    await git(b.repo, ["init", "-b", "main"])
    const lockA = await strandIndexLock(a.repo)
    const lockB = await strandIndexLock(b.repo)

    // #when
    const [reportA, reportB] = await withWriterLock(a, async () => [
      await sweepStrandedGitLockFiles(a.repo, 50),
      await withWriterLock(b, () => sweepStrandedGitLockFiles(b.repo, 50)),
    ] as const)

    // #then
    expect(reportB.removed).toEqual([])
    expect(existsSync(lockB)).toBe(true)
    expect(reportA.removed).toEqual([lockA])
  }, 30_000)
})
