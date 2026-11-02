import { afterEach, describe, expect, test } from "bun:test"
import { spawn } from "node:child_process"
import { randomUUID } from "node:crypto"
import { existsSync, readFileSync, realpathSync, writeFileSync } from "node:fs"
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises"
import { hostname, tmpdir } from "node:os"
import { join } from "node:path"

import { git } from "../concurrency/two-process-kit.test-support"
import { buildIdentityPaths } from "../identity"
import { acquireLock, createLockRecord, memoryWriterLockPath, releaseLock, setLockCandidateFsForTests } from "../locks"
import { acquireWithoutDirectorySweep } from "../locks/acquire"
import { exitedWithin, probeUntil } from "../locks/process-liveness.test-support"
import { link } from "../fs/resilient"
import { sweepStrandedGitLockFiles } from "./repo-lock-sweep"

// omo #10199 r5 delta review LOW: the proof that the writer lock's previous owner died authorizes
// reclaiming git locks only for the acquisition that took the lock over FROM that owner. If a live
// writer B takes the lock between the dead owner's reclamation and this acquisition, B's writes and
// git children came after the death, so this acquisition succeeds B, not the dead owner, and must
// not inherit the proof. The lock-candidate link seam injects B at exactly that point.

const roots: string[] = []
let restoreFs: (() => void) | undefined
afterEach(async () => {
  restoreFs?.()
  restoreFs = undefined
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

const takeoverPaths = [
  { path: "the directory sweep of acquireLock", acquire: acquireLock },
  { path: "this contender's own stale-owner recovery", acquire: acquireWithoutDirectorySweep },
] as const

async function deadOwnerWithStrandedIndexLock(): Promise<ReturnType<typeof buildIdentityPaths>> {
  const root = realpathSync.native(await mkdtemp(join(tmpdir(), "memory-sweep-handoff-")))
  roots.push(root)
  const paths = buildIdentityPaths(root, "handoff")
  await mkdir(paths.repo, { recursive: true })
  await mkdir(paths.locks, { recursive: true })
  await git(paths.repo, ["init", "-b", "main"])
  const dead = spawn(process.execPath, ["-e", ""], { stdio: "ignore" })
  expect(await exitedWithin(dead, 5_000)).toBe(true)
  await writeFile(memoryWriterLockPath(paths.locks), JSON.stringify({
    pid: dead.pid, process_start: "unavailable", hostname: hostname(), nonce: randomUUID(),
    created_at: new Date().toISOString(), purpose: "memory-write",
  }), "utf8")
  const holder = spawn("git", ["-C", paths.repo, "update-index", "--stdin"], { stdio: ["pipe", "ignore", "ignore"] })
  const indexLock = join(paths.repo, ".git", "index.lock")
  expect(await probeUntil(() => existsSync(indexLock), 10_000)).toBe(true)
  holder.kill("SIGKILL")
  expect(await exitedWithin(holder, 5_000)).toBe(true)
  return paths
}

describe("the dead-owner proof goes only to the dead owner's immediate successor (omo #10199 r5 delta LOW)", () => {
  for (const { path: takeoverPath, acquire } of takeoverPaths) test.skipIf(process.platform === "win32")(`#given a live writer takes the lock between the dead owner's reclamation by ${takeoverPath} and this acquisition #when this acquisition sweeps #then the stranded lock is kept`, async () => {
    // #given: a dead recorded owner A, and a killed git holder's stranded index.lock
    const paths = await deadOwnerWithStrandedIndexLock()
    const writerLockPath = memoryWriterLockPath(paths.locks)
    const indexLock = join(paths.repo, ".git", "index.lock")

    // A live writer B publishes the moment THIS acquisition tries to: B is this process (alive).
    const mine = await createLockRecord("memory-write")
    const writerB = await createLockRecord("memory-write")
    let injected = false
    restoreFs = setLockCandidateFsForTests({
      link: async (candidate, target) => {
        if (!injected && target === writerLockPath && readFileSync(candidate, "utf8").includes(mine.nonce)) {
          injected = true
          writeFileSync(target, JSON.stringify(writerB), "utf8")
        }
        return link(candidate, target)
      },
    })

    // #when: this acquisition waits behind B, B finishes, then this acquisition holds the lock
    const acquired = acquire(writerLockPath, mine, { waitTimeoutMs: 10_000, retryDelayMs: 5 })
    expect(await probeUntil(() => injected, 10_000)).toBe(true)
    expect(await releaseLock(writerLockPath, writerB)).toBe(true)
    await acquired
    try {
      const report = await sweepStrandedGitLockFiles(paths.repo, 50)

      // #then
      expect(report.removed).toEqual([])
      expect(report.kept).toEqual([{ path: indexLock, reason: "owner-not-proven-dead" }])
    } finally {
      await releaseLock(writerLockPath, mine)
    }
  }, 30_000)

  for (const { path: takeoverPath, acquire } of takeoverPaths) test.skipIf(process.platform === "win32")(`#given a live writer publishes and releases between this acquisition's lost publish and its re-read, after ${takeoverPath} #when this acquisition sweeps #then the stranded lock is kept`, async () => {
    // #given
    const paths = await deadOwnerWithStrandedIndexLock()
    const writerLockPath = memoryWriterLockPath(paths.locks)
    const indexLock = join(paths.repo, ".git", "index.lock")
    const mine = await createLockRecord("memory-write")
    const writerB = await createLockRecord("memory-write")
    let cameAndWent = false
    restoreFs = setLockCandidateFsForTests({
      link: async (candidate, target) => {
        if (cameAndWent || target !== writerLockPath || !readFileSync(candidate, "utf8").includes(mine.nonce)) return link(candidate, target)
        cameAndWent = true
        writeFileSync(target, JSON.stringify(writerB), "utf8")
        try {
          return await link(candidate, target)
        } finally {
          expect(await releaseLock(writerLockPath, writerB)).toBe(true)
        }
      },
    })

    // #when
    await acquire(writerLockPath, mine, { waitTimeoutMs: 10_000, retryDelayMs: 5 })
    try {
      const report = await sweepStrandedGitLockFiles(paths.repo, 50)

      // #then
      expect(cameAndWent).toBe(true)
      expect(report.removed).toEqual([])
      expect(report.kept).toEqual([{ path: indexLock, reason: "owner-not-proven-dead" }])
    } finally {
      await releaseLock(writerLockPath, mine)
    }
  }, 30_000)
})
