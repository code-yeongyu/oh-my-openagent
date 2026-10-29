import { afterEach, describe, expect, mock, spyOn, test } from "bun:test"
import * as fs from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { createDagFileStore } from "./store"

// The window behind #9465: when the hard link is refused (windows-latest), a DAG lock is published
// with an exclusive create, and the path holds no owner record until the publisher's write lands.

const parentSessionId = "ses_parent"
const runKey = "release-plan"
const incompleteLockGraceMs = 1_000
const cleanupRoots: string[] = []

afterEach(() => {
  mock.restore()
  for (const root of cleanupRoots.splice(0)) fs.rmSync(root, { recursive: true, force: true })
})

function tempProject(): string {
  const directory = fs.mkdtempSync(join(tmpdir(), "senpi-dag-ownerless-"))
  cleanupRoots.push(directory)
  return directory
}

function refuseHardLinks(): void {
  spyOn(fs, "linkSync").mockImplementation(() => {
    throw Object.assign(new Error("operation not permitted, link"), { code: "EPERM" })
  })
}

function hostPidAt(path: string): number | undefined {
  if (!fs.existsSync(path)) return undefined
  const value = JSON.parse(fs.readFileSync(path, "utf8")) as { readonly hostPid?: number }
  return value.hostPid
}

describe("DAG key lock published without a hard link", () => {
  test("#given the publisher created the lock but has not written its owner record #when a live contender observes it #then the contender waits out the grace and the publisher never owns a lock it lost", () => {
    // given
    const project = tempProject()
    const publisher = createDagFileStore({ project_dir: project }, { isProcessAlive: () => true })
    let createdAtMs = 0
    let contenderCalls = 0
    // The contender's clock starts at the ownerless lock's mtime and moves 100 ms per reading, so
    // the grace elapses after a fixed number of readings and nothing depends on wall-clock time.
    const contender = createDagFileStore(
      { project_dir: project },
      { isProcessAlive: () => true, now: () => createdAtMs + (contenderCalls += 1) * 100 },
    )
    const canonical = publisher.paths.keyLock(parentSessionId, runKey)
    refuseHardLinks()
    const realOpen = fs.openSync
    let preempted = false
    let contenderEnteredAfterMs: number | undefined
    spyOn(fs, "openSync").mockImplementation((path, flags, mode) => {
      const fd = realOpen(path, flags, mode)
      if (preempted || flags !== "wx" || path !== canonical) return fd
      // when the publisher is preempted between its exclusive create and its owner-record write
      preempted = true
      createdAtMs = fs.statSync(canonical).mtimeMs
      contenderCalls = 0
      contender.withKeyLock(parentSessionId, runKey, () => {
        contenderEnteredAfterMs = contenderCalls * 100
      })
      return fd
    })
    let publisherEntries = 0
    let publisherHeldLockOnDisk = false

    publisher.withKeyLock(parentSessionId, runKey, () => {
      publisherEntries += 1
      publisherHeldLockOnDisk = hostPidAt(canonical) === process.pid
    })

    // then
    expect(preempted).toBe(true)
    expect({
      contenderWaitedOutGrace: contenderEnteredAfterMs !== undefined && contenderEnteredAfterMs >= incompleteLockGraceMs,
      publisherEntries,
      publisherHeldLockOnDisk,
      lockReleased: !fs.existsSync(canonical),
    }).toEqual({
      contenderWaitedOutGrace: true,
      publisherEntries: 1,
      publisherHeldLockOnDisk: true,
      lockReleased: true,
    })
  })

  test("#given an ownerless lock body left by a publisher that crashed #when it is older than the grace #then the next acquirer reclaims it", () => {
    // given
    const project = tempProject()
    const store = createDagFileStore({ project_dir: project }, { isProcessAlive: () => true })
    const canonical = store.paths.keyLock(parentSessionId, runKey)
    fs.mkdirSync(store.paths.locks, { recursive: true })
    fs.writeFileSync(canonical, "")
    const crashedAt = new Date(Date.now() - 10 * incompleteLockGraceMs)
    fs.utimesSync(canonical, crashedAt, crashedAt)
    let entered = false

    // when
    store.withKeyLock(parentSessionId, runKey, () => {
      entered = hostPidAt(canonical) === process.pid
    })

    // then
    expect(entered).toBe(true)
    expect(fs.existsSync(canonical)).toBe(false)
  })
})
