import { afterEach, describe, expect, test } from "bun:test"
import { createHash } from "node:crypto"
import { mkdtemp, readFile, rm, unlink, utimes, writeFile } from "node:fs/promises"
import { hostname, tmpdir } from "node:os"
import path from "node:path"

import {
  LockContentionError,
  LockRecoveryBlockedError,
  acquireLock,
  createLockRecord,
  releaseLock,
  setLockCandidateFsForTests,
} from "./index"
import {
  CANDIDATE_STALE_AGE_MS,
  sweepStaleLockCandidates,
} from "./candidate-sweep"

// These PIDs are likely absent on POSIX CI. If a slot is reused, the deliberately
// wrong process_start still proves the seeded owner is not the current process.
const DEAD_PID_PRIMARY = 23997
const DEAD_PID_RECOVERY = 23813
const DEAD_PID_CLAIM = 23717
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

function recoveryClaimPath(recoveryPath: string, recoveryRaw: string): string {
  const digest = createHash("sha256").update(recoveryRaw).digest("hex")
  const claimId = [
    digest.slice(0, 8),
    digest.slice(8, 12),
    digest.slice(12, 16),
    digest.slice(16, 20),
    digest.slice(20, 32),
  ].join("-")
  return `${recoveryPath}.claim-${claimId}`
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
      const staleAt = new Date(Date.now() - CANDIDATE_STALE_AGE_MS - 1_000)
      await utimes(recoveryPath, staleAt, staleAt)
      const replacement = await createLockRecord("reflection-scheduler:recovery")
      const restore = setLockCandidateFsForTests({
        afterRecoveryClaim: async (pathToRelease) => {
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

  test(
    "#given a dead reclaimer left its generation claim behind" +
      " #when a new session attempts acquisition" +
      " #then it advances through a successor claim and makes progress",
    async () => {
      if (process.platform === "win32") return

      // #given
      const lockDir = await createLockDir()
      const lockPath = path.join(lockDir, "reflection-scheduler.lock")
      const recoveryPath = `${lockPath}.recovery`
      const recoveryRaw = `${JSON.stringify(deadRecoveryRecord())}\n`
      const claimPath = recoveryClaimPath(recoveryPath, recoveryRaw)
      const deadClaim = {
        ...deadRecoveryRecord(),
        pid: DEAD_PID_CLAIM,
        nonce: "00000000-dead-dead-dead-000000000003",
        purpose: "reflection-scheduler:recovery-claim",
      }
      const deadClaimRaw = `${JSON.stringify(deadClaim)}\n`
      const successorPath = recoveryClaimPath(recoveryPath, deadClaimRaw)
      await writeFile(lockPath, `${JSON.stringify(deadPrimaryRecord())}\n`)
      await writeFile(recoveryPath, recoveryRaw)
      await writeFile(claimPath, deadClaimRaw)
      const contender = await createLockRecord("reflection-scheduler")

      try {
        // #when / #then
        await expect(acquireLock(lockPath, contender, { waitTimeoutMs: 0 })).resolves.toBeUndefined()
        expect(JSON.parse(await readFile(lockPath, "utf8")).nonce).toBe(contender.nonce)
        expect(JSON.parse(await readFile(claimPath, "utf8")).nonce).toBe(deadClaim.nonce)
        await expect(readFile(successorPath, "utf8")).rejects.toMatchObject({ code: "ENOENT" })
      } finally {
        await releaseLock(lockPath, contender)
      }
    },
  )

  test(
    "#given a legacy claim contains only the stale recovery owner" +
      " #when a new session cannot identify the active claimant" +
      " #then recovery fails closed during a rolling upgrade",
    async () => {
      if (process.platform === "win32") return

      // #given
      const lockDir = await createLockDir()
      const lockPath = path.join(lockDir, "reflection-scheduler.lock")
      const recoveryPath = `${lockPath}.recovery`
      const recoveryRaw = `${JSON.stringify(deadRecoveryRecord())}\n`
      const claimPath = recoveryClaimPath(recoveryPath, recoveryRaw)
      await writeFile(lockPath, `${JSON.stringify(deadPrimaryRecord())}\n`)
      await writeFile(recoveryPath, recoveryRaw)
      await writeFile(claimPath, recoveryRaw)
      const contender = await createLockRecord("reflection-scheduler")

      // #when
      const error = await acquireLock(lockPath, contender, { waitTimeoutMs: 0 }).catch(
        (cause) => cause,
      )

      // #then
      expect(error).toBeInstanceOf(LockRecoveryBlockedError)
      expect(error.reason).toBe("legacy_claim")
      expect(await readFile(recoveryPath, "utf8")).toBe(recoveryRaw)
      expect(await readFile(claimPath, "utf8")).toBe(recoveryRaw)
    },
  )

  test(
    "#given every bounded successor slot belongs to a dead claimant" +
      " #when another contender attempts recovery" +
      " #then it receives a non-retriable repair diagnostic",
    async () => {
      if (process.platform === "win32") return

      // #given
      const lockDir = await createLockDir()
      const lockPath = path.join(lockDir, "reflection-scheduler.lock")
      const recoveryPath = `${lockPath}.recovery`
      const recoveryRaw = `${JSON.stringify(deadRecoveryRecord())}\n`
      await writeFile(lockPath, `${JSON.stringify(deadPrimaryRecord())}\n`)
      await writeFile(recoveryPath, recoveryRaw)
      let predecessorRaw = recoveryRaw
      for (let depth = 0; depth < 64; depth += 1) {
        const claimPath = recoveryClaimPath(recoveryPath, predecessorRaw)
        const claim = {
          ...deadRecoveryRecord(),
          pid: DEAD_PID_CLAIM,
          nonce: `00000000-dead-dead-dead-${String(depth).padStart(12, "0")}`,
          purpose: "reflection-scheduler:recovery-claim",
        }
        predecessorRaw = `${JSON.stringify(claim)}\n`
        await writeFile(claimPath, predecessorRaw)
      }
      const contender = await createLockRecord("reflection-scheduler")

      // #when
      const error = await acquireLock(lockPath, contender, { waitTimeoutMs: 0 }).catch(
        (cause) => cause,
      )

      // #then
      expect(error).toBeInstanceOf(LockRecoveryBlockedError)
      expect(error.reason).toBe("claim_chain_exhausted")
      expect(error.retriable).toBe(false)
    },
  )

  test(
    "#given two contenders observe the same dead generation claim" +
      " #when one publishes its successor while the other is paused" +
      " #then the paused contender cannot displace the elected claimant",
    async () => {
      if (process.platform === "win32") return

      // #given
      const lockDir = await createLockDir()
      const lockPath = path.join(lockDir, "reflection-scheduler.lock")
      const recoveryPath = `${lockPath}.recovery`
      const recoveryRaw = `${JSON.stringify(deadRecoveryRecord())}\n`
      const claimPath = recoveryClaimPath(recoveryPath, recoveryRaw)
      const deadClaim = {
        ...deadRecoveryRecord(),
        pid: DEAD_PID_CLAIM,
        nonce: "00000000-dead-dead-dead-000000000003",
        purpose: "reflection-scheduler:recovery-claim",
      }
      await writeFile(lockPath, `${JSON.stringify(deadPrimaryRecord())}\n`)
      await writeFile(recoveryPath, recoveryRaw)
      await writeFile(claimPath, `${JSON.stringify(deadClaim)}\n`)
      const pausedRecord = await createLockRecord("reflection-scheduler")
      const electedRecord = await createLockRecord("reflection-scheduler")
      const pausedReadDeadClaim = Promise.withResolvers<void>()
      const resumePausedContender = Promise.withResolvers<void>()
      const electedClaimPublished = Promise.withResolvers<void>()
      const resumeElectedContender = Promise.withResolvers<void>()
      let deadClaimReads = 0
      let reclamationHooks = 0
      const restore = setLockCandidateFsForTests({
        afterDeadRecoveryClaimRead: async () => {
          deadClaimReads += 1
          if (deadClaimReads !== 1) return
          pausedReadDeadClaim.resolve()
          await resumePausedContender.promise
        },
        afterRecoveryClaim: async () => {
          reclamationHooks += 1
          if (reclamationHooks !== 1) return
          electedClaimPublished.resolve()
          await resumeElectedContender.promise
        },
      })

      try {
        const pausedAcquisition = acquireLock(lockPath, pausedRecord, {
          waitTimeoutMs: 0,
        }).then(
          () => undefined,
          (cause: unknown) => cause,
        )
        await pausedReadDeadClaim.promise
        const electedAcquisition = acquireLock(lockPath, electedRecord, {
          waitTimeoutMs: 0,
        }).then(
          () => undefined,
          (cause: unknown) => cause,
        )
        await electedClaimPublished.promise

        // #when
        resumePausedContender.resolve()
        const pausedError = await pausedAcquisition
        resumeElectedContender.resolve()
        const electedError = await electedAcquisition

        // #then
        expect(pausedError).toBeInstanceOf(LockContentionError)
        expect(electedError).toBeUndefined()
        expect(reclamationHooks).toBe(1)
        expect(JSON.parse(await readFile(lockPath, "utf8")).nonce).toBe(electedRecord.nonce)
      } finally {
        resumePausedContender.resolve()
        resumeElectedContender.resolve()
        restore()
        await releaseLock(lockPath, pausedRecord)
        await releaseLock(lockPath, electedRecord)
      }
    },
  )

  test(
    "#given two contenders observe the same stale recovery owner" +
      " #when the first contender pauses after winning reclamation" +
      " #then the second contender cannot reclaim or acquire ahead of it",
    async () => {
      if (process.platform === "win32") return

      // #given
      const lockDir = await createLockDir()
      const lockPath = path.join(lockDir, "reflection-scheduler.lock")
      const recoveryPath = `${lockPath}.recovery`
      await writeFile(lockPath, `${JSON.stringify(deadPrimaryRecord())}\n`)
      await writeFile(recoveryPath, `${JSON.stringify(deadRecoveryRecord())}\n`)
      const firstRecord = await createLockRecord("reflection-scheduler")
      const secondRecord = await createLockRecord("reflection-scheduler")
      const firstClaimed = Promise.withResolvers<void>()
      const resumeFirst = Promise.withResolvers<void>()
      let reclamationHooks = 0
      const restore = setLockCandidateFsForTests({
        afterRecoveryClaim: async () => {
          reclamationHooks += 1
          if (reclamationHooks !== 1) return
          firstClaimed.resolve()
          await resumeFirst.promise
        },
      })

      try {
        const firstAcquisition = acquireLock(lockPath, firstRecord, {
          waitTimeoutMs: 0,
        }).then(
          () => undefined,
          (cause: unknown) => cause,
        )
        await firstClaimed.promise
        const sweptClaims = await sweepStaleLockCandidates(
          lockDir,
          () => Date.now() + CANDIDATE_STALE_AGE_MS + 1_000,
        )

        // #when
        const secondError = await acquireLock(lockPath, secondRecord, {
          waitTimeoutMs: 0,
        }).then(
          () => undefined,
          (cause: unknown) => cause,
        )
        resumeFirst.resolve()
        const firstError = await firstAcquisition

        // #then
        expect(sweptClaims).toBe(0)
        expect(secondError).toBeInstanceOf(LockContentionError)
        expect(firstError).toBeUndefined()
        expect(JSON.parse(await readFile(lockPath, "utf8")).nonce).toBe(firstRecord.nonce)
      } finally {
        resumeFirst.resolve()
        restore()
        await releaseLock(lockPath, firstRecord)
        await releaseLock(lockPath, secondRecord)
      }
    },
  )
})
