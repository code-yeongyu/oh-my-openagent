import { afterEach, describe, expect, test } from "bun:test"
import { spawn } from "node:child_process"
import { randomUUID } from "node:crypto"
import { existsSync, realpathSync } from "node:fs"
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises"
import { hostname, tmpdir } from "node:os"
import { join } from "node:path"

import { git } from "../concurrency/two-process-kit.test-support"
import { buildIdentityPaths } from "../identity"
import { createLockRecord, memoryWriterLockPath, withLock } from "../locks"
import { exitedWithin } from "../locks/process-liveness.test-support"
import type { GitLockScans } from "./lock-scans"
import { StrandedGitLockError, withStrandedGitLockRecovery } from "./repo-lock-sweep"

// omo #10199 / #10322: on hosts where the holder and repository-user scans cannot answer (hosted CI
// runners and systemd desktops whose same-uid processes cannot be inspected), a stranded lock from
// a writer proven dead is still KEPT, and the refusal names it with the way out. The real scans
// answer on the hosts that run this suite, so the unanswerable host is injected here.

const roots: string[] = []
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

async function deadWriterWithStrandedIndexLock() {
  const root = realpathSync.native(await mkdtemp(join(tmpdir(), "memory-sweep-indeterminate-")))
  roots.push(root)
  const paths = buildIdentityPaths(root, "indeterminate")
  await mkdir(paths.repo, { recursive: true })
  await mkdir(paths.locks, { recursive: true })
  await git(paths.repo, ["init", "-b", "main"])
  const dead = spawn(process.execPath, ["-e", ""], { stdio: "ignore" })
  expect(await exitedWithin(dead, 5_000)).toBe(true)
  await writeFile(memoryWriterLockPath(paths.locks), JSON.stringify({
    pid: dead.pid, process_start: "unavailable", hostname: hostname(), nonce: randomUUID(),
    created_at: new Date().toISOString(), purpose: "memory-write",
  }), "utf8")
  await writeFile(join(paths.repo, "fact.md"), "fact\n", "utf8")
  const lockPath = join(paths.repo, ".git", "index.lock")
  await writeFile(lockPath, "", "utf8")
  return { paths, lockPath }
}

async function failureUnder(scans: GitLockScans) {
  const { paths, lockPath } = await deadWriterWithStrandedIndexLock()
  const failure = await withLock(memoryWriterLockPath(paths.locks), await createLockRecord("memory-write"), () =>
    withStrandedGitLockRecovery(paths.repo, () => git(paths.repo, ["add", "--", "fact.md"]), scans),
  ).catch((error: unknown) => error)
  return { failure, lockPath }
}

describe("a stranded lock on a host whose scans cannot answer is kept (omo #10199, #10322)", () => {
  test.skipIf(process.platform === "win32")("#given the repository-user scan cannot answer #when the dead writer's successor sweeps #then the lock is kept as possibly in use, with the way out", async () => {
    // #when
    const { failure, lockPath } = await failureUnder({ findHolders: async () => [], findRepoUsers: async () => null })

    // #then
    expect(failure).toBeInstanceOf(StrandedGitLockError)
    if (!(failure instanceof StrandedGitLockError)) return
    expect(failure.kept).toEqual([{ path: lockPath, reason: "repo-in-use" }])
    expect(failure.message.split("\n")).toContain(`  /memory unlock ${lockPath}`)
    expect(existsSync(lockPath)).toBe(true)
  })

  test.skipIf(process.platform === "win32")("#given only the open-holder scan cannot answer #when the dead writer's successor sweeps #then the lock is kept as possibly held, with the way out", async () => {
    // #when
    const { failure, lockPath } = await failureUnder({ findHolders: async () => null, findRepoUsers: async () => [] })

    // #then
    expect(failure).toBeInstanceOf(StrandedGitLockError)
    if (!(failure instanceof StrandedGitLockError)) return
    expect(failure.kept).toEqual([{ path: lockPath, reason: "open-holder" }])
    expect(failure.message.split("\n")).toContain(`  /memory unlock ${lockPath}`)
    expect(existsSync(lockPath)).toBe(true)
  })

  test.skipIf(process.platform === "win32")("#given both scans answer that nothing uses it #when the dead writer's successor sweeps #then the lock is reclaimed and the command runs", async () => {
    // #when
    const { failure, lockPath } = await failureUnder({ findHolders: async () => [], findRepoUsers: async () => [] })

    // #then
    expect(failure).toBe("")
    expect(existsSync(lockPath)).toBe(false)
  })
})
