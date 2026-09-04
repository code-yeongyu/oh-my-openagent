import { afterEach, describe, expect, test } from "bun:test"
import { mkdtemp, readFile, rm, unlink, writeFile } from "node:fs/promises"
import { hostname, tmpdir } from "node:os"
import path from "node:path"

import {
  LockContentionError,
  acquireLock,
  createLockRecord,
  setLockCandidateFsForTests,
} from "./index"

// These PIDs are likely absent on POSIX CI. If a slot is reused, the deliberately
// wrong process_start still proves the seeded owner is not the current process.
const DEAD_PID_PRIMARY = 23997
const DEAD_PID_RECOVERY = 23813
const DEAD_START_PRIMARY = "ps-lstart:Fri Aug 28 13:34:49 2026"
const DEAD_START_RECOVERY = "ps-lstart:Fri Aug 28 13:34:46 2026"

const temporaryDirectories: string[] = []

async function createLockDir(): Promise<string> {
  const directory = await mkdtemp(path.join(tmpdir(), "memory-stale-recovery-"))
  temporaryDirectories.push(directory)
  return directory
}

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map(async (directory) => {
      await rm(directory, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 })
    }),
  )
})

function deadPrimaryRecord(): object {
  return {
    pid: DEAD_PID_PRIMARY,
    process_start: DEAD_START_PRIMARY,
    hostname: hostname(),
    nonce: "00000000-dead-dead-dead-000000000001",
    created_at: "2026-08-28T13:34:49.000Z",
    purpose: "reflection-scheduler",
  }
}

function deadRecoveryRecord(): object {
  return {
    pid: DEAD_PID_RECOVERY,
    process_start: DEAD_START_RECOVERY,
    hostname: hostname(),
    nonce: "00000000-dead-dead-dead-000000000002",
    created_at: "2026-08-28T13:34:46.000Z",
    purpose: "reflection-scheduler:recovery",
  }
}

describe("stale recovery lock deadlock (issue #7573)", () => {
  test(
    "#given both the primary lock and its .recovery companion are held by dead processes" +
      " #when a new session attempts acquisition" +
      " #then it succeeds without manual file deletion",
    async () => {
      if (process.platform === "win32") {
        // getProcessStartIdentity has no Windows probe; recovery fails closed on Windows.
        return
      }

      // #given — seed both lock files with dead-owner records (pid dead, wrong process_start)
      const lockDir = await createLockDir()
      const lockPath = path.join(lockDir, "reflection-scheduler.lock")
      const recoveryPath = `${lockPath}.recovery`

      await writeFile(lockPath, `${JSON.stringify(deadPrimaryRecord())}\n`)
      await writeFile(recoveryPath, `${JSON.stringify(deadRecoveryRecord())}\n`)

      // #when — a new session tries to acquire the lock
      const contender = await createLockRecord("reflection-scheduler")

      // #then — must succeed; without the fix publishExclusive for the recovery lock
      // returns false (EEXIST) and recoverDeadOwner bails, leaving the stale primary in place
      await expect(acquireLock(lockPath, contender, { waitTimeoutMs: 0 })).resolves.toBeUndefined()
    },
  )

  test(
    "#given only the primary lock is stale (no recovery companion)" +
      " #when a new session attempts acquisition" +
      " #then it succeeds (existing behaviour must not regress)",
    async () => {
      if (process.platform === "win32") return

      // #given
      const lockDir = await createLockDir()
      const lockPath = path.join(lockDir, "reflection-scheduler.lock")
      await writeFile(lockPath, `${JSON.stringify(deadPrimaryRecord())}\n`)

      // #when / #then
      const contender = await createLockRecord("reflection-scheduler")
      await expect(acquireLock(lockPath, contender, { waitTimeoutMs: 0 })).resolves.toBeUndefined()
    },
  )

  test(
    "#given the recovery lock is held by a live process" +
      " #when a new session attempts acquisition" +
      " #then it fails closed (live recovery holder must not be evicted)",
    async () => {
      if (process.platform === "win32") return

      // #given — primary is stale but recovery is live (current process)
      const lockDir = await createLockDir()
      const lockPath = path.join(lockDir, "reflection-scheduler.lock")
      const recoveryPath = `${lockPath}.recovery`

      await writeFile(lockPath, `${JSON.stringify(deadPrimaryRecord())}\n`)
      const liveRecoveryRecord = await createLockRecord("reflection-scheduler:recovery")
      await writeFile(recoveryPath, `${JSON.stringify(liveRecoveryRecord)}\n`)

      // #when
      const contender = await createLockRecord("reflection-scheduler")
      const error = await acquireLock(lockPath, contender, { waitTimeoutMs: 0 }).catch((e) => e)

      // #then — live recovery holder must block the contender
      expect(error).toBeInstanceOf(LockContentionError)
    },
  )

  test(
    "#given a stale recovery observation is replaced before cleanup" +
      " #when the contender resumes stale reclamation" +
      " #then it preserves the replacement owner and fails closed",
    async () => {
      if (process.platform === "win32") return

      // #given
      const lockDir = await createLockDir()
      const lockPath = path.join(lockDir, "reflection-scheduler.lock")
      const recoveryPath = `${lockPath}.recovery`
      await writeFile(lockPath, `${JSON.stringify(deadPrimaryRecord())}\n`)
      await writeFile(recoveryPath, `${JSON.stringify(deadRecoveryRecord())}\n`)
      const replacement = await createLockRecord("reflection-scheduler:recovery")
      const restore = setLockCandidateFsForTests({
        beforeRecoveryRelease: async (pathToRelease) => {
          await unlink(pathToRelease)
          await writeFile(pathToRelease, `${JSON.stringify(replacement)}\n`)
        },
      })

      try {
        // #when
        const contender = await createLockRecord("reflection-scheduler")
        const error = await acquireLock(lockPath, contender, { waitTimeoutMs: 0 }).catch((cause) => cause)

        // #then
        expect(error).toBeInstanceOf(LockContentionError)
        expect(JSON.parse(await readFile(recoveryPath, "utf8")).nonce).toBe(replacement.nonce)
      } finally {
        restore()
      }
    },
  )
})
