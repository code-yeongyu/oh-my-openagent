import { afterEach, expect, test } from "bun:test"
import { realpathSync } from "node:fs"
import { appendFile, mkdir, mkdtemp, readFile, rm, utimes, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { git } from "../concurrency/two-process-kit.test-support"
import { buildIdentityPaths } from "../identity"
import { acquireLock, createLockRecord, memoryWriterLockPath, releaseLock } from "../locks"
import type { GitLockScans } from "./lock-scans"
import { type KeptGitLockReason, STALE_LOCK_JOURNAL, sweepStrandedGitLockFiles } from "./repo-lock-sweep"
import { disableFixtureAutoMaintenance } from "./test-repo-config.test-support"

const roots: string[] = []
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

const STALE = { staleAgeMs: 10 * 60_000, staleSettleMs: 20 }
const idleScans: GitLockScans = { findHolders: async () => [], findRepoUsers: async () => [] }

async function repoWithStaleLock(
  ageMs: number,
): Promise<{ repo: string; lock: string; locks: string; release: () => Promise<void> }> {
  const root = realpathSync.native(await mkdtemp(join(tmpdir(), "memory-stale-lock-")))
  roots.push(root)
  const paths = buildIdentityPaths(root, "stale-lock")
  await mkdir(paths.repo, { recursive: true })
  await mkdir(paths.locks, { recursive: true })
  await git(paths.repo, ["init", "-b", "main"])
  disableFixtureAutoMaintenance(paths.repo)
  await writeFile(join(paths.repo, "notes.md"), "first\n", "utf8")
  await git(paths.repo, ["-c", "user.name=t", "-c", "user.email=t@omo.local", "add", "--", "notes.md"])
  await git(paths.repo, [
    "-c",
    "user.name=t",
    "-c",
    "user.email=t@omo.local",
    "-c",
    "commit.gpgsign=false",
    "commit",
    "-m",
    "init",
  ])
  const record = await createLockRecord("memory-write")
  await acquireLock(memoryWriterLockPath(paths.locks), record, { waitTimeoutMs: 5_000, retryDelayMs: 5 })
  const lock = join(paths.repo, ".git", "index.lock")
  await writeFile(lock, "")
  const at = new Date(Date.now() - ageMs)
  await utimes(lock, at, at)
  return {
    repo: paths.repo,
    lock,
    locks: paths.locks,
    release: async () => void (await releaseLock(memoryWriterLockPath(paths.locks), record)),
  }
}

test("#given a 0-byte index.lock 70 minutes old with no owner record, no holder and no git process #when the writer sweeps #then it is removed and the removal is journaled", async () => {
  const fixture = await repoWithStaleLock(70 * 60_000)
  try {
    const report = await sweepStrandedGitLockFiles(fixture.repo, 20, idleScans, STALE)
    expect(report.removed).toEqual([fixture.lock])
    expect(report.kept).toEqual([])
    const journal = (await readFile(join(fixture.locks, STALE_LOCK_JOURNAL), "utf8"))
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line))
    expect(journal).toHaveLength(1)
    expect(journal[0]).toMatchObject({ path: fixture.lock, size: 0, checks: { repoUsers: 0, openHolders: 0 } })
    expect(journal[0].ageMs).toBeGreaterThanOrEqual(70 * 60_000)
  } finally {
    await fixture.release()
  }
})

const keptCases: ReadonlyArray<{
  name: string
  ageMs: number
  scans: (lock: string) => GitLockScans
  reason: KeptGitLockReason
}> = [
  {
    name: "it is younger than the stale age",
    ageMs: 5 * 60_000,
    scans: () => idleScans,
    reason: "owner-not-proven-dead",
  },
  {
    name: "a process holds it open",
    ageMs: 70 * 60_000,
    scans: () => ({ ...idleScans, findHolders: async () => [4242] }),
    reason: "open-holder",
  },
  {
    name: "open holders cannot be determined (a wedged lsof)",
    ageMs: 70 * 60_000,
    scans: () => ({ ...idleScans, findHolders: async () => null }),
    reason: "open-holder",
  },
  {
    name: "a process works in the repository",
    ageMs: 70 * 60_000,
    scans: () => ({ ...idleScans, findRepoUsers: async () => [4242] }),
    reason: "repo-in-use",
  },
  {
    name: "it changes during the settle window",
    ageMs: 70 * 60_000,
    scans: (lock) => ({
      ...idleScans,
      findHolders: async () => {
        await appendFile(lock, "x")
        return []
      },
    }),
    reason: "changed-during-settle",
  },
]

for (const kept of keptCases) {
  test(`#given an ownerless stale index.lock #when ${kept.name} #then it stays held with reason ${kept.reason}`, async () => {
    const fixture = await repoWithStaleLock(kept.ageMs)
    try {
      const report = await sweepStrandedGitLockFiles(fixture.repo, 20, kept.scans(fixture.lock), STALE)
      expect(report.removed).toEqual([])
      expect(report.kept).toEqual([{ path: fixture.lock, reason: kept.reason }])
    } finally {
      await fixture.release()
    }
  })
}
