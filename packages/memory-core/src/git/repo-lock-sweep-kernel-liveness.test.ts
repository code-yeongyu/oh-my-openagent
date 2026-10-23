import { afterEach, describe, expect, test, setDefaultTimeout } from "bun:test"
import { spawn, type ChildProcess } from "node:child_process"
import { randomUUID } from "node:crypto"
import { existsSync, realpathSync } from "node:fs"
import { chmod, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises"
import { hostname, tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

import { assertRepoIntegrity, git } from "../concurrency/two-process-kit.test-support"
import { createNodeGitExec } from "./exec"
import { buildIdentityPaths } from "../identity"
import { acquireLock, createLockRecord, getProcessStartIdentity, memoryWriterLockPath, releaseLock } from "../locks"
import { exitedWithin, pidAlive, probeUntil } from "../locks/process-liveness.test-support"
import type { GitLockScans } from "./lock-scans"
import { sweepStrandedGitLockFiles } from "./repo-lock-sweep"

setDefaultTimeout(60_000)

// omo #10322: on Linux the /proc holder and repository-user scans cannot answer whenever a
// same-uid process is not dumpable ((sd-pam), an sshd session, and on hosted runners the user's
// own live git), so the dead-writer reclaim never fired there. Liveness of the memory writers'
// git now comes from the kernel: every memory-core git run holds a shared flock that its git
// child inherits, and the sweep takes it exclusively. The host scans are injected here so every
// host reproduces the blind (or the lying) host exactly.

const BLIND: GitLockScans = { findHolders: async () => null, findRepoUsers: async () => null }
// A host scan that misses a live cooperating git (it answers "nobody"): only the kernel lock can
// keep the live writer's lock then.
const MISSES_EVERYONE: GitLockScans = { findHolders: async () => [], findRepoUsers: async () => [] }

const execModule = fileURLToPath(new URL("./exec.ts", import.meta.url))

const roots: string[] = []
const children: ChildProcess[] = []
afterEach(async () => {
  for (const child of children.splice(0)) if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL")
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

type OwnerRecord = { readonly pid: number; readonly processStart: string; readonly ranGitUnderActivityLock: boolean }

async function identityRepo(agentId: string) {
  const root = realpathSync.native(await mkdtemp(join(tmpdir(), "memory-kernel-liveness-")))
  roots.push(root)
  const paths = buildIdentityPaths(root, agentId)
  await mkdir(paths.repo, { recursive: true })
  await mkdir(paths.locks, { recursive: true })
  await git(paths.repo, ["init", "-b", "main"])
  for (const [key, value] of [["commit.gpgsign", "false"], ["user.name", "Kernel Liveness"], ["user.email", "kernel@omo.local"]] as const) {
    await git(paths.repo, ["config", key, value])
  }
  return { root, paths, writerLockPath: memoryWriterLockPath(paths.locks) }
}

async function writeOwner(writerLockPath: string, owner: OwnerRecord): Promise<void> {
  await writeFile(writerLockPath, JSON.stringify({
    pid: owner.pid,
    process_start: owner.processStart,
    hostname: hostname(),
    nonce: randomUUID(),
    created_at: new Date().toISOString(),
    purpose: "memory-write",
    ...(owner.ranGitUnderActivityLock ? { git_activity_lock: true } : {}),
  }), "utf8")
}

async function deadPid(): Promise<number> {
  const dead = spawn(process.execPath, ["-e", ""], { stdio: "ignore" })
  expect(await exitedWithin(dead, 5_000)).toBe(true)
  if (dead.pid === undefined) throw new Error("dead child has no pid")
  return dead.pid
}

async function strandIndexLock(repoDir: string): Promise<string> {
  const holder = spawn("git", ["-C", repoDir, "update-index", "--stdin"], { stdio: ["pipe", "ignore", "ignore"] })
  const lockPath = join(repoDir, ".git", "index.lock")
  expect(await probeUntil(() => existsSync(lockPath), 10_000)).toBe(true)
  holder.kill("SIGKILL")
  expect(await exitedWithin(holder, 5_000)).toBe(true)
  return lockPath
}

async function sweepAsSuccessor(writerLockPath: string, repoDir: string, scans: GitLockScans) {
  const record = await createLockRecord("memory-write")
  await acquireLock(writerLockPath, record, { waitTimeoutMs: 5_000, retryDelayMs: 5 })
  try {
    return await sweepStrandedGitLockFiles(repoDir, 50, scans)
  } finally {
    await releaseLock(writerLockPath, record)
  }
}

describe("the git-activity lock never recreates a removed memory home (omo #10322)", () => {
  test.skipIf(process.platform === "win32")("#given an identity whose directory was removed #when a git command runs in its repo #then nothing is recreated", async () => {
    // #given
    const { root, paths } = await identityRepo("kernel-removed-home")
    const identityDir = dirname(paths.repo)
    await rm(identityDir, { recursive: true, force: true })

    // #when
    const result = await createNodeGitExec().run(["status"], { cwd: paths.repo, timeoutMs: 10_000 })

    // #then
    expect(result.code).toBe(128)
    expect(existsSync(identityDir)).toBe(false)
    expect(existsSync(root)).toBe(true)
  })

  test.skipIf(process.platform === "win32" || process.getuid?.() === 0)("#given a memory home whose lock directory this user cannot write #when a read-only git command runs #then it still runs (omo #10604 review LOW 3)", async () => {
    // #given
    const { paths } = await identityRepo("kernel-unwritable-locks")
    await chmod(paths.locks, 0o500)

    try {
      // #when
      const result = await createNodeGitExec().run(["status", "--porcelain"], { cwd: paths.repo, timeoutMs: 10_000 })

      // #then
      expect(result.code).toBe(0)
    } finally {
      await chmod(paths.locks, 0o700)
    }
  })
})

describe("dead-writer git-lock reclaim on hosts whose /proc scans cannot answer (omo #10322)", () => {
  test.skipIf(process.platform === "win32")("#given a dead writer that ran its git under the activity lock #when its successor sweeps on a blind host #then the stranded lock is reclaimed", async () => {
    // #given
    const { paths, writerLockPath } = await identityRepo("kernel-dead")
    await writeOwner(writerLockPath, { pid: await deadPid(), processStart: "unavailable", ranGitUnderActivityLock: true })
    const lockPath = await strandIndexLock(paths.repo)

    // #when
    const report = await sweepAsSuccessor(writerLockPath, paths.repo, BLIND)

    // #then
    expect(report).toEqual({ removed: [lockPath], kept: [] })
    expect(existsSync(lockPath)).toBe(false)
  })

  test.skipIf(process.platform === "win32")("#given the recorded pid now belongs to another process (different start time) #when the successor sweeps on a blind host #then the owner counts as dead and the lock is reclaimed", async () => {
    // #given: a live process holds the recorded pid, but its start identity contradicts the record
    const { paths, writerLockPath } = await identityRepo("kernel-pid-reuse")
    const reused = spawn("sleep", ["30"], { stdio: "ignore" })
    children.push(reused)
    const reusedPid = reused.pid
    if (reusedPid === undefined) throw new Error("reused child has no pid")
    expect(pidAlive(reusedPid)).toBe(true)
    const actualStart = await getProcessStartIdentity(reusedPid)
    if (actualStart === null) throw new Error("start identity unreadable for a live child")
    const scheme = actualStart.slice(0, actualStart.indexOf(":"))
    await writeOwner(writerLockPath, { pid: reusedPid, processStart: `${scheme}:1`, ranGitUnderActivityLock: true })
    const lockPath = await strandIndexLock(paths.repo)

    // #when
    const report = await sweepAsSuccessor(writerLockPath, paths.repo, BLIND)

    // #then
    expect(report).toEqual({ removed: [lockPath], kept: [] })
    expect(pidAlive(reusedPid)).toBe(true)
  })

  test.skipIf(process.platform === "win32")("#given a dead writer from a version that did not run git under the activity lock #when its successor sweeps on a blind host #then the lock is kept as possibly in use", async () => {
    // #given: nothing says the dead writer's git children held the kernel lock, so an orphan of it
    // could still be live and invisible
    const { paths, writerLockPath } = await identityRepo("kernel-legacy-owner")
    await writeOwner(writerLockPath, { pid: await deadPid(), processStart: "unavailable", ranGitUnderActivityLock: false })
    const lockPath = await strandIndexLock(paths.repo)

    // #when
    const report = await sweepAsSuccessor(writerLockPath, paths.repo, BLIND)

    // #then
    expect(report).toEqual({ removed: [], kept: [{ path: lockPath, reason: "repo-in-use" }] })
    expect(existsSync(lockPath)).toBe(true)
  })

  test.skipIf(process.platform === "win32")("#given a SIGKILLed writer whose git commit still runs as an orphan #when the successor sweeps and the host scans see nobody #then the kernel lock keeps the orphan's index.lock and its commit lands", async () => {
    // #given: a real memory-core writer process runs `git commit -a` through the production git
    // exec; the commit parks in commit-msg (index.lock written, its fd closed), then the writer
    // is SIGKILLed and its git runs on as an orphan
    const { root, paths, writerLockPath } = await identityRepo("kernel-live-orphan")
    await writeFile(join(paths.repo, "notes.md"), "first\n", "utf8")
    await git(paths.repo, ["add", "--", "notes.md"])
    await git(paths.repo, ["commit", "-m", "init"])
    const sentinel = join(root, "commit-msg-started")
    const release = join(root, "commit-msg-release")
    const hookPath = join(paths.repo, ".git", "hooks", "commit-msg")
    await writeFile(hookPath, ["#!/bin/sh", `: > "${sentinel}"`, `while [ ! -f "${release}" ]; do sleep 0.05; done`, "exit 0", ""].join("\n"), "utf8")
    await chmod(hookPath, 0o755)
    await writeFile(join(paths.repo, "notes.md"), "second\n", "utf8")
    const writerScript = join(root, "writer.ts")
    await writeFile(writerScript, [
      `import { createNodeGitExec } from ${JSON.stringify(execModule)}`,
      `await createNodeGitExec().run(["commit", "-a", "-m", "orphaned"], { cwd: process.argv[2] ?? "", timeoutMs: 120_000 })`,
      "",
    ].join("\n"), "utf8")
    const writer = spawn(process.execPath, [writerScript, paths.repo], { stdio: "ignore" })
    children.push(writer)
    const writerPid = writer.pid
    if (writerPid === undefined) throw new Error("writer has no pid")
    await writeOwner(writerLockPath, { pid: writerPid, processStart: "unavailable", ranGitUnderActivityLock: true })
    expect(await probeUntil(() => existsSync(sentinel), 15_000)).toBe(true)
    writer.kill("SIGKILL")
    expect(await exitedWithin(writer, 5_000)).toBe(true)
    const lockPath = join(paths.repo, ".git", "index.lock")
    expect(existsSync(lockPath)).toBe(true)

    let report: Awaited<ReturnType<typeof sweepAsSuccessor>>
    try {
      // #when
      report = await sweepAsSuccessor(writerLockPath, paths.repo, MISSES_EVERYONE)
    } finally {
      await writeFile(release, "", "utf8")
    }

    // #then
    expect(report).toEqual({ removed: [], kept: [{ path: lockPath, reason: "repo-in-use" }] })
    expect(await probeUntil(async () => (await git(paths.repo, ["log", "-1", "--format=%s"])).trim() === "orphaned", 15_000)).toBe(true)
    expect(await probeUntil(() => !existsSync(lockPath), 10_000)).toBe(true)
    expect(await git(paths.repo, ["status", "--porcelain", "--", "notes.md"])).toBe("")
    await assertRepoIntegrity(paths.repo)
  })
})
