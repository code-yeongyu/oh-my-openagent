import { afterEach, describe, expect, test } from "bun:test"
import { spawn } from "node:child_process"
import { randomUUID } from "node:crypto"
import { existsSync, readFileSync, realpathSync } from "node:fs"
import { chmod, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises"
import { hostname, tmpdir } from "node:os"
import { join } from "node:path"

import { assertRepoIntegrity, git } from "../concurrency/two-process-kit.test-support"
import { buildIdentityPaths } from "../identity"
import { acquireLock, createLockRecord, memoryWriterLockPath, releaseLock } from "../locks"
import { pidAlive, probeUntil } from "../locks/process-liveness.test-support"
import { StrandedGitLockError, sweepStrandedGitLockFiles, withStrandedGitLockRecovery } from "./repo-lock-sweep"

// omo #10199 review round 5, HIGH 1: the dead-owner proof covers the Node process that held the
// memory-write lock, never the `git` child that actually created index.lock. SIGKILL the owner
// and git runs on as an orphan - here parked in its commit-msg hook, where git has already
// written index.lock and CLOSED its fd, so no open-file check can see it. The owner IS proven
// dead and this process DOES hold the writer lock through a takeover, so both ownership gates
// pass; the lock must still survive because a live process is working inside the repository.

const roots: string[] = []
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

type OrphanFixture = {
  readonly repoDir: string
  readonly writerLockPath: string
  readonly lockPath: string
  readonly orphanPid: number
  readonly release: () => Promise<void>
}

async function orphanedCommitParkedInCommitMsg(): Promise<OrphanFixture> {
  const root = realpathSync.native(await mkdtemp(join(tmpdir(), "memory-orphan-git-")))
  roots.push(root)
  const paths = buildIdentityPaths(root, "orphan-git")
  await mkdir(paths.repo, { recursive: true })
  await mkdir(paths.locks, { recursive: true })
  await git(paths.repo, ["init", "-b", "main"])
  for (const [key, value] of [["commit.gpgsign", "false"], ["user.name", "Orphan Owner"], ["user.email", "orphan@omo.local"]] as const) {
    await git(paths.repo, ["config", key, value])
  }
  await writeFile(join(paths.repo, "notes.md"), "first\n", "utf8")
  await git(paths.repo, ["add", "--", "notes.md"])
  await git(paths.repo, ["commit", "-m", "init"])

  const sentinel = join(root, "commit-msg-started")
  const releasePath = join(root, "commit-msg-release")
  const hookPath = join(paths.repo, ".git", "hooks", "commit-msg")
  await writeFile(hookPath, ["#!/bin/sh", `: > "${sentinel}"`, `while [ ! -f "${releasePath}" ]; do sleep 0.05; done`, "exit 0", ""].join("\n"), "utf8")
  await chmod(hookPath, 0o755)
  await writeFile(join(paths.repo, "notes.md"), "second\n", "utf8")

  // The owner: a process that launched `git commit -a` and is then SIGKILLed while git is parked.
  // Its pid becomes the dead owner recorded in the memory-write lock, exactly like a SIGKILLed
  // memory writer whose git child keeps running.
  const gitPidFile = join(root, "git.pid")
  const owner = spawn("sh", ["-c", `git -C "${paths.repo}" commit -a -m orphaned & echo $! > "${gitPidFile}"; wait`], { stdio: "ignore" })
  const ownerExit = new Promise<void>((resolve) => owner.once("exit", () => resolve()))
  expect(await probeUntil(() => existsSync(sentinel) && existsSync(gitPidFile), 10_000)).toBe(true)
  const ownerPid = owner.pid
  if (ownerPid === undefined) throw new Error("owner has no pid")
  const writerLockPath = memoryWriterLockPath(paths.locks)
  await writeFile(writerLockPath, JSON.stringify({
    pid: ownerPid,
    process_start: "unavailable",
    hostname: hostname(),
    nonce: randomUUID(),
    created_at: new Date().toISOString(),
    purpose: "memory-write",
  }), "utf8")
  owner.kill("SIGKILL")
  await ownerExit

  const orphanPid = Number.parseInt(readFileSync(gitPidFile, "utf8"), 10)
  expect(pidAlive(orphanPid)).toBe(true)
  const lockPath = join(paths.repo, ".git", "index.lock")
  expect(existsSync(lockPath)).toBe(true)
  return {
    repoDir: paths.repo,
    writerLockPath,
    lockPath,
    orphanPid,
    release: async () => {
      await writeFile(releasePath, "", "utf8")
      expect(await probeUntil(() => !pidAlive(orphanPid), 10_000)).toBe(true)
    },
  }
}

async function expectOrphanCommitLanded(repoDir: string): Promise<void> {
  // A sweep that stole index.lock fails the orphan's commit with exit 128 ("unable to write new
  // index file"); a correct sweep lets it land with the index in step with HEAD.
  expect((await git(repoDir, ["log", "-1", "--format=%s"])).trim()).toBe("orphaned")
  expect(await git(repoDir, ["status", "--porcelain", "--", "notes.md"])).toBe("")
  await assertRepoIntegrity(repoDir)
}

describe("stranded git lock sweep vs an ORPHANED live git child of a proven-dead owner (omo #10199 r5 HIGH 1)", () => {
  test.skipIf(process.platform === "win32")("#given the writer lock taken over from a SIGKILLed owner whose git commit still runs #when the sweep runs #then the orphan's lock survives as repo-in-use and its commit lands", async () => {
    // #given
    const fixture = await orphanedCommitParkedInCommitMsg()
    const record = await createLockRecord("memory-write")
    await acquireLock(fixture.writerLockPath, record, { waitTimeoutMs: 5_000, retryDelayMs: 5 })
    try {
      // #when
      const report = await sweepStrandedGitLockFiles(fixture.repoDir, 50)

      // #then
      expect(report.removed).toEqual([])
      expect(existsSync(fixture.lockPath)).toBe(true)
      expect(report.kept).toEqual([{ path: fixture.lockPath, reason: "repo-in-use" }])
    } finally {
      await fixture.release()
      await releaseLock(fixture.writerLockPath, record)
    }
    await expectOrphanCommitLanded(fixture.repoDir)
  }, 30_000)

  test.skipIf(process.platform === "win32")("#given the same orphan #when a memory write hits its lock #then the write fails with the repo-in-use reason and the orphan's commit lands", async () => {
    // #given
    const fixture = await orphanedCommitParkedInCommitMsg()
    const record = await createLockRecord("memory-write")
    await acquireLock(fixture.writerLockPath, record, { waitTimeoutMs: 5_000, retryDelayMs: 5 })
    let failure: unknown
    try {
      await writeFile(join(fixture.repoDir, "later.md"), "later\n", "utf8")
      // #when: the same recovery wrapper every GitMemoryRepo index/ref mutation runs through
      failure = await withStrandedGitLockRecovery(fixture.repoDir, () => git(fixture.repoDir, ["add", "--", "later.md"]))
        .then(() => undefined, (error: unknown) => error)
    } finally {
      await fixture.release()
      await releaseLock(fixture.writerLockPath, record)
    }

    // #then
    expect(failure).toBeInstanceOf(StrandedGitLockError)
    expect(String((failure as Error).message)).toContain("still working in the repository")
    expect(String((failure as Error).message)).not.toContain("cannot be proven dead")
    await expectOrphanCommitLanded(fixture.repoDir)
  }, 30_000)
})

describe("StrandedGitLockError names the reason each lock was kept (omo #10199 r5 LOW 6)", () => {
  test("#given one lock per kept reason #then each gets its own explanation", () => {
    const error = new StrandedGitLockError([
      { path: "/r/.git/index.lock", reason: "owner-not-proven-dead" },
      { path: "/r/.git/HEAD.lock", reason: "repo-in-use" },
      { path: "/r/.git/config.lock", reason: "changed-during-settle" },
      { path: "/r/.git/packed-refs.lock", reason: "open-holder" },
      { path: "/r/.git/refs/heads/main.lock", reason: "unlink-failed" },
    ])
    expect(error.paths).toEqual([
      "/r/.git/index.lock",
      "/r/.git/HEAD.lock",
      "/r/.git/config.lock",
      "/r/.git/packed-refs.lock",
      "/r/.git/refs/heads/main.lock",
    ])
    const lines = error.message.split("\n")
    expect(lines.find((line) => line.includes("index.lock"))).toContain("cannot be proven dead")
    expect(lines.find((line) => line.includes("HEAD.lock"))).toContain("still working in the repository")
    expect(lines.find((line) => line.includes("config.lock"))).toContain("changed while it was being checked")
    expect(lines.find((line) => line.includes("packed-refs.lock"))).toContain("open")
    expect(lines.find((line) => line.includes("main.lock"))).toContain("could not be removed")
    expect(lines.filter((line) => line.includes("cannot be proven dead"))).toHaveLength(1)
  })
})
