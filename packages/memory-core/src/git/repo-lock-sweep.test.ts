import { afterEach, describe, expect, test, setDefaultTimeout } from "bun:test"
import { spawn, type ChildProcess } from "node:child_process"
import { randomUUID } from "node:crypto"
import { existsSync, readFileSync, realpathSync } from "node:fs"
import { chmod, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises"
import { hostname, tmpdir } from "node:os"
import { join } from "node:path"

import { buildIdentityPaths } from "../identity"
import { acquireLock, createLockRecord, memoryWriterLockPath, releaseLock } from "../locks"
import { exitedWithin, probeUntil } from "../locks/process-liveness.test-support"
import { installHooks } from "../memfs/hooks"
import { assertRepoIntegrity, git } from "../concurrency/two-process-kit.test-support"
import { GitMemoryRepo } from "./repo"
import { sweepStrandedGitLockFiles } from "./repo-lock-sweep"
import { findOpenFileHolderPids, unreadableFdDirMeansHeld } from "./open-file-holders"
import { SAME_UID_GIT_UNINSPECTABLE } from "./host-scan-blind.test-support"

// A holder scan answers within LSOF_ANSWER_BOUND_MS (60 s) on a loaded macOS host; the default 20 s
// test budget would cut a correct but slow answer short.
setDefaultTimeout(90_000)

// omo #10199 review HIGH 1: the stranded-lock sweep's premise - "git keeps the lock fd open from
// create until rename" - is false. Git's lockfile API closes the descriptor after writing the lock
// and keeps the FILE as the lock until commit or rollback: commit's prepare_index closes
// index.lock before the commit-msg hook runs, and the files ref backend closes each ref lock
// before the reference-transaction hook's "prepared" stage. In both windows lsof sees no holder
// while the commit is live, so an open-fd sweep deletes a live writer's lock and tears its
// transaction (exit 128, index out of step with HEAD). These tests drive LIVE commits parked in
// exactly those windows, on a production-shaped repo (GitMemoryRepo.init with the real hooks),
// and require the sweep to leave the locks. Reclamation is only ever allowed under the held
// memory-write lock after the lock protocol proved the recorded previous owner dead.

const roots: string[] = []
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

type Exit = { readonly code: number | null; readonly signal: NodeJS.Signals | null }

function exitOf(child: ChildProcess): Promise<Exit> {
  return new Promise((resolve) => child.once("exit", (code, signal) => resolve({ code, signal })))
}

// Subscribe-first exit tracking: the `exit` event fires as soon as the commit process dies, while
// `close` would wait for the post-commit hook's BACKGROUND mirror push (stdout/stderr pipes stay
// open past exit and stall the harness indefinitely). stderr stays ignored for the same reason.
function trackExit(child: ChildProcess): { readonly promise: Promise<Exit>; observed: Exit | null } {
  const tracker = { promise: Promise.resolve<Exit>({ code: null, signal: null }), observed: null as Exit | null }
  tracker.promise = new Promise<Exit>((resolve) => {
    child.once("exit", (code, signal) => {
      tracker.observed = { code, signal }
      resolve({ code, signal })
    })
  })
  return tracker
}

// The sweep's return shape changes with the fix (bare list -> report); the property under test -
// WHICH locks were removed - is identical at both heads.
function removedPaths(sweepResult: unknown): readonly string[] {
  return Array.isArray(sweepResult) ? sweepResult : (sweepResult as { readonly removed: readonly string[] }).removed
}

// Proof that the lock file has NO open holder right now, through the same production helper the
// sweep uses (findOpenFileHolderPids: /proc scan on linux, lsof elsewhere). A null answer means
// "cannot determine" and fails the test - a live-writer test can never proceed on an unknown.
async function expectNoHolder(lockPath: string): Promise<void> {
  const holders = await findOpenFileHolderPids(lockPath)
  expect(holders, `open holders of ${lockPath}`).toEqual([])
}

async function writeSlowHook(repoDir: string, name: string, script: string): Promise<void> {
  const hookPath = join(repoDir, ".git", "hooks", name)
  await writeFile(hookPath, script, "utf8")
  await chmod(hookPath, 0o755)
}

async function releaseAndAwaitCommit(commit: ChildProcess, releasePath: string, tracked: { readonly promise: Promise<Exit> }): Promise<Exit> {
  await writeFile(releasePath, "", "utf8")
  const timer = setTimeout(() => commit.kill("SIGKILL"), 10_000)
  try {
    return await tracked.promise
  } finally {
    clearTimeout(timer)
  }
}

describe("stranded git lock sweep vs LIVE writers (omo #10199 review)", () => {
  test.skipIf(process.platform === "win32" || SAME_UID_GIT_UNINSPECTABLE)("#given a LIVE commit -a parked in its commit-msg hook holding a closed-fd index.lock #when the sweep runs #then the lock survives and the commit lands", async () => {
    // #given: a production-shaped memory repo (GitMemoryRepo.init installs the real hooks) and a
    // commit-msg hook that parks the commit AFTER the -a shape's prepare_index wrote index.lock
    // and CLOSED its fd: lsof sees no holder while the commit is live (verified: git 2.50.1).
    const root = realpathSync.native(await mkdtemp(join(tmpdir(), "memory-live-commit-msg-")))
    roots.push(root)
    const dir = join(root, "repo")
    const repo = new GitMemoryRepo({ dir, agentId: "live-commit-msg", installHooks: (d) => void installHooks(d) })
    await repo.init()
    const sentinel = join(root, "commit-msg-started")
    const release = join(root, "commit-msg-release")
    await writeSlowHook(dir, "commit-msg", [
      "#!/bin/sh",
      `: > "${sentinel}"`,
      `while [ ! -f "${release}" ]; do sleep 0.05; done`,
      "exit 0",
      "",
    ].join("\n"))

    await writeFile(join(dir, "notes.md"), "---\ndescription: live commit-msg write\n---\nbody\n", "utf8")
    await git(dir, ["add", "--", "notes.md"])
    // Both output pipes ignored: the post-commit hook's background mirror push would hold them
    // open past the commit's exit and stall any `close`-based waiter.
    const commit = spawn("git", ["-C", dir, "commit", "-a", "-m", "live write"], { stdio: ["ignore", "ignore", "ignore"], windowsHide: true })
    const tracked = trackExit(commit)
    const lockPath = join(dir, ".git", "index.lock")

    try {
      // The hook's sentinel is the exact completion signal: git runs commit-msg only after
      // prepare_index wrote index.lock and closed its fd, so the file exists with no holder.
      expect(await probeUntil(() => existsSync(sentinel), 10_000)).toBe(true)
      expect(existsSync(lockPath)).toBe(true)
      await expectNoHolder(lockPath)

      // #when
      const removed = removedPaths(await sweepStrandedGitLockFiles(dir, 50))

      // #then: the live writer's lock is not the sweep's to take.
      expect(removed).toEqual([])
      expect(existsSync(lockPath)).toBe(true)
    } finally {
      // A sweep that took the lock strands the commit at exit 128 ("unable to write new index
      // file") with the index out of step with HEAD; a correct sweep lets it land cleanly.
      const exit = await releaseAndAwaitCommit(commit, release, tracked)
      expect(exit.code, `commit exit after sweep`).toBe(0)
    }
    await assertRepoIntegrity(dir)
  }, 30_000)

  test.skipIf(process.platform === "win32" || SAME_UID_GIT_UNINSPECTABLE)("#given a LIVE commit -a parked in its reference-transaction hook holding closed-fd ref locks #when the sweep runs #then the ref lock survives and the commit lands", async () => {
    // #given: the files ref backend closes each ref lock after write_ref_to_lockfile; the
    // reference-transaction hook's "prepared" stage runs while refs/heads/main.lock exists with
    // no open holder (verified: git 2.50.1, commit -a shape).
    const root = realpathSync.native(await mkdtemp(join(tmpdir(), "memory-live-ref-txn-")))
    roots.push(root)
    const dir = join(root, "repo")
    const repo = new GitMemoryRepo({ dir, agentId: "live-ref-txn", installHooks: (d) => void installHooks(d) })
    await repo.init()
    const states = join(root, "ref-txn-states")
    const release = join(root, "ref-txn-release")
    await writeSlowHook(dir, "reference-transaction", [
      "#!/bin/sh",
      `echo "$1" >> "${states}"`,
      `if [ "$1" = "prepared" ]; then`,
      `  while [ ! -f "${release}" ]; do sleep 0.05; done`,
      "fi",
      "exit 0",
      "",
    ].join("\n"))

    await writeFile(join(dir, "notes.md"), "---\ndescription: live ref-txn write\n---\nbody\n", "utf8")
    await git(dir, ["add", "--", "notes.md"])
    // Output pipes ignored for the same post-commit background-push reason as the commit-msg test.
    const commit = spawn("git", ["-C", dir, "commit", "-a", "-m", "live write"], { stdio: ["ignore", "ignore", "ignore"], windowsHide: true })
    const tracked = trackExit(commit)
    const lockPath = join(dir, ".git", "refs", "heads", "main.lock")

    try {
      // The hook also runs for "preparing"; only "prepared" guarantees the ref locks are written.
      expect(await probeUntil(() => existsSync(states) && readFileSync(states, "utf8").includes("prepared\n"), 10_000)).toBe(true)
      expect(existsSync(lockPath)).toBe(true)
      await expectNoHolder(lockPath)

      // #when
      const removed = removedPaths(await sweepStrandedGitLockFiles(dir, 50))

      // #then
      expect(removed).toEqual([])
      expect(existsSync(lockPath)).toBe(true)
    } finally {
      const exit = await releaseAndAwaitCommit(commit, release, tracked)
      expect(exit.code, `commit exit after sweep`).toBe(0)
    }
    await assertRepoIntegrity(dir)
  }, 30_000)

  test.skipIf(process.platform === "win32")("#given stranded index.lock debris of UNKNOWN ownership #when the sweep runs #then the debris is left in place", async () => {
    // #given: a killed git process strands index.lock, but no memory-write lock record ties the
    // debris to a proven-dead previous owner (a crashed facts pipeline, a user shell). Ownership
    // is unknown, so the sweep must leave the lock rather than trust open-fd evidence alone.
    const root = realpathSync.native(await mkdtemp(join(tmpdir(), "memory-sweep-unknown-owner-")))
    roots.push(root)
    const dir = join(root, "repo")
    const repo = new GitMemoryRepo({ dir, agentId: "unknown-owner", installHooks: (d) => void installHooks(d) })
    await repo.init()
    const lockPath = join(dir, ".git", "index.lock")
    const holder = spawn("git", ["-C", dir, "update-index", "--stdin"], { stdio: ["pipe", "ignore", "ignore"], windowsHide: true })
    expect(await probeUntil(() => existsSync(lockPath), 10_000)).toBe(true)
    holder.kill("SIGKILL")
    expect(await exitedWithin(holder, 5_000)).toBe(true)

    // #when
    const removed = removedPaths(await sweepStrandedGitLockFiles(dir, 50))

    // #then
    expect(removed).toEqual([])
    expect(existsSync(lockPath)).toBe(true)
  }, 30_000)

  test.skipIf(process.platform === "win32")("#given stranded index.lock debris of unknown ownership #when a memory write hits the lock error #then a typed error surfaces and the debris is left", async () => {
    // #given: same unknown-ownership debris, now on the write path itself. The ownerless
    // preflight sweep used to delete it silently; the write must instead fail loud and typed.
    const root = realpathSync.native(await mkdtemp(join(tmpdir(), "memory-write-unknown-owner-")))
    roots.push(root)
    const dir = join(root, "repo")
    const repo = new GitMemoryRepo({ dir, agentId: "unknown-owner-write", installHooks: (d) => void installHooks(d) })
    await repo.init()
    const lockPath = join(dir, ".git", "index.lock")
    const holder = spawn("git", ["-C", dir, "update-index", "--stdin"], { stdio: ["pipe", "ignore", "ignore"], windowsHide: true })
    expect(await probeUntil(() => existsSync(lockPath), 10_000)).toBe(true)
    holder.kill("SIGKILL")
    expect(await exitedWithin(holder, 5_000)).toBe(true)

    // #when
    await writeFile(join(dir, "later.md"), "---\ndescription: later write\n---\nlater\n", "utf8")
    const write = repo.commitWrite(["later.md"], "later write", { agentId: "unknown-owner-write", authorName: "Unknown Owner" })

    // #then
    await expect(write).rejects.toThrow(/index\.lock/)
    expect(existsSync(lockPath)).toBe(true)
  }, 30_000)

  test.skipIf(process.platform === "win32" || SAME_UID_GIT_UNINSPECTABLE)("#given a memory-write lock taken over from a proven-dead recorded owner #when the sweep runs under that lock #then a killed git holder's index.lock is reclaimed", async () => {
    // #given: the healing path the sweep exists for. A previous memory writer died (kernel-proof:
    // the pid is gone), this process took the writer lock over through the dead-owner protocol,
    // and a killed git holder left index.lock behind. Only here is reclamation allowed.
    const root = realpathSync.native(await mkdtemp(join(tmpdir(), "memory-sweep-takeover-")))
    roots.push(root)
    const paths = buildIdentityPaths(root, "sweep-takeover")
    await mkdir(paths.repo, { recursive: true })
    await mkdir(paths.locks, { recursive: true })
    await git(paths.repo, ["init", "-b", "main"])
    await git(paths.repo, ["config", "commit.gpgsign", "false"])
    const writerLockPath = memoryWriterLockPath(paths.locks)

    const deadChild = spawn(process.execPath, ["-e", ""], { stdio: "ignore", windowsHide: true })
    await exitOf(deadChild)
    const deadPid = deadChild.pid
    if (deadPid === undefined) throw new Error("dead child has no pid")
    await writeFile(writerLockPath, JSON.stringify({
      pid: deadPid,
      process_start: "unavailable",
      hostname: hostname(),
      nonce: randomUUID(),
      created_at: new Date().toISOString(),
      purpose: "memory-write",
    }), "utf8")

    const record = await createLockRecord("memory-write")
    await acquireLock(writerLockPath, record, { waitTimeoutMs: 5_000, retryDelayMs: 5 })
    try {
      const holder = spawn("git", ["-C", paths.repo, "update-index", "--stdin"], { stdio: ["pipe", "ignore", "ignore"], windowsHide: true })
      const lockPath = join(paths.repo, ".git", "index.lock")
      expect(await probeUntil(() => existsSync(lockPath), 10_000)).toBe(true)
      holder.kill("SIGKILL")
      expect(await exitedWithin(holder, 5_000)).toBe(true)

      // #when
      const removed = removedPaths(await sweepStrandedGitLockFiles(paths.repo, 50))

      // #then
      expect(removed).toEqual([lockPath])
      expect(existsSync(lockPath)).toBe(false)
    } finally {
      await releaseLock(writerLockPath, record)
    }
  }, 30_000)

  describe("the conservative /proc unreadable-fd-dir rule", () => {
    test("#given a same-user process whose fd dir is unreadable #then it counts as held", () => {
      expect(unreadableFdDirMeansHeld(1000, 1000)).toBe(true)
    })
    test("#given another user's process whose fd dir is unreadable #then it is skipped, matching non-root lsof", () => {
      expect(unreadableFdDirMeansHeld(0, 1000)).toBe(false)
      expect(unreadableFdDirMeansHeld(1001, 1000)).toBe(false)
    })
  })
})
