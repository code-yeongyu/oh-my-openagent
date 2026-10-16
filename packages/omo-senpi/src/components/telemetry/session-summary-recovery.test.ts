import { afterEach, describe, expect, test } from "bun:test"
import { existsSync, readdirSync, renameSync, writeFileSync } from "node:fs"
import { join } from "node:path"

import { CHECKPOINT_MAX_TURNS } from "./omo-native-session-summary"
import { CORRUPT } from "./session-summary-files"
import { purgeOptedOutQueue } from "./session-summary-optout-purge"
import { withRecoveryOps } from "./session-summary-recovery-storage"
import { OWNER_STALE_MS, SUMMARY_TTL_MS, summaryDir } from "./session-summary-storage"
import { createTempStateDirs, createTestRecorder, rows, summaryTurn } from "./session-summary.test-support"

// Protocol contract (plan todo 8): a window is claimed only when its heartbeat is older than 5 minutes AND
// its owner is gone; a claimed window is published once as `recovered` under its own window id.

const stateDirs = createTempStateDirs()
afterEach(() => stateDirs.cleanup())

const T0 = 1_000_000
const STALE = OWNER_STALE_MS + 1

describe("session_summary recovery ownership", () => {
  test("#given a dead owner with a stale heartbeat #when two processes sweep #then the window is sent once as recovered with its window id", async () => {
    const dir = stateDirs.make()
    const dead = createTestRecorder({ dir, pid: 999_999, startAt: T0 })
    await dead.summary.recordTurn("dead", summaryTurn({ turnIndex: 0, totalTokens: 7 }))
    await dead.summary.recordTurn("dead", summaryTurn({ turnIndex: 1, totalTokens: 5 }))
    const windowId = readWindow(dead, "dead").windowId

    // Both sweepers are alive and see each other; only the window's owner is dead.
    const next = createTestRecorder({ dir, pid: 111_111, alivePids: [222_222], startAt: T0 + STALE })
    const racing = createTestRecorder({ dir, pid: 222_222, alivePids: [111_111], startAt: T0 + STALE })
    await Promise.all([next.summary.recover(), racing.summary.recover()])

    const recovered = [...next.published, ...racing.published]
    expect(recovered).toHaveLength(1)
    expect(recovered[0]?.uuid).toBe(windowId)
    expect(recovered[0]?.properties).toMatchObject({ $session_id: "dead", summary_seq: 0, ended_by: "recovered", turns: 2, total_tokens: 12, is_final: false })
  })

  test("#given a dead owner whose heartbeat is still fresh #when a sweep runs #then nothing is claimed, and resuming the session continues the same window", async () => {
    const dir = stateDirs.make()
    const dead = createTestRecorder({ dir, pid: 999_998, startAt: T0 })
    await dead.summary.recordTurn("s1", summaryTurn({ turnIndex: 0 }))

    const resumed = createTestRecorder({ dir, pid: 111_112, startAt: T0 + OWNER_STALE_MS - 1 })
    await resumed.summary.recover()
    expect(resumed.published).toHaveLength(0)
    await resumed.summary.recordTurn("s1", summaryTurn({ turnIndex: 1 }))
    await resumed.summary.finish("s1", "quit")
    expect(rows(resumed.published)).toEqual([[0, "shutdown", 2]])
  })

  test("#given a live owner with a stale heartbeat (a sleeping laptop) #when another process sweeps #then the window is never claimed", async () => {
    const dir = stateDirs.make()
    const sleeper = createTestRecorder({ dir, pid: 333_333, startAt: T0 })
    await sleeper.summary.recordTurn("s1", summaryTurn())

    const other = createTestRecorder({ dir, pid: 444_444, otherPidsAlive: true, startAt: T0 + STALE * 10 })
    await other.summary.recover()
    expect(other.published).toHaveLength(0)
    expect(readWindow(sleeper, "s1").owner).toEqual(sleeper.storage.owner)
  })

  test("#given the owner's pid now belongs to a later OmO process #when a sweep runs #then the dead owner's window is recovered", async () => {
    const dir = stateDirs.make()
    const dead = createTestRecorder({ dir, pid: 555_555, bootId: "boot-old", startAt: T0 })
    await dead.summary.recordTurn("s1", summaryTurn())
    const reuser = createTestRecorder({ dir, pid: 555_555, bootId: "boot-new", startAt: T0 })
    await reuser.summary.recordTurn("other", summaryTurn())

    const sweeper = createTestRecorder({ dir, pid: 666_666, otherPidsAlive: true, startAt: T0 + STALE })
    await sweeper.summary.recover()
    expect(rows(sweeper.published)).toEqual([[0, "recovered", 1]])
  })

  test("#given a live owner whose heartbeat timer ticks #when another process sweeps 8 minutes later #then the window stays with its owner", async () => {
    const dir = stateDirs.make()
    const owner = createTestRecorder({ dir, pid: 777_777, startAt: T0 })
    await owner.summary.recordTurn("s1", summaryTurn())
    owner.advance(4 * 60_000)
    owner.tick()

    const sweeper = createTestRecorder({ dir, pid: 888_888, startAt: T0 + 8 * 60_000 })
    await sweeper.summary.recover()
    expect(sweeper.published).toHaveLength(0)
  })
})

describe("session_summary recovery hygiene", () => {
  test("#given a corrupt window file #when a sweep runs #then it is removed with a diagnostic and live sessions still report", async () => {
    const dir = stateDirs.make()
    const dead = createTestRecorder({ dir, pid: 999_997, startAt: T0 })
    await dead.summary.recordTurn("s1", summaryTurn())
    const file = join(summaryDir(dir), "s1.json")
    writeFileSync(file, "{not json")

    const next = createTestRecorder({ dir, pid: 121_212, startAt: T0 + STALE })
    await next.summary.recordTurn("s2", summaryTurn())
    await next.summary.finish("s2", "quit")

    expect(existsSync(file)).toBe(false)
    expect(next.diagnostics.map(({ event }) => event)).toContain("telemetry_activity_state_read_failed")
    expect(rows(next.published)).toEqual([[0, "shutdown", 1]])
  })

  test("#given temp and claim files left by dead processes #when a sweep runs #then temps are deleted and a dead claimer's window is handed back and recovered", async () => {
    const dir = stateDirs.make()
    const dead = createTestRecorder({ dir, pid: 999_991, startAt: T0 })
    await dead.summary.recordTurn("s1", summaryTurn())
    const base = summaryDir(dir)
    writeFileSync(join(base, "s9.json.999992-boot-999992.tmp"), "{}")
    renameSync(join(base, "s1.json"), join(base, "s1.json.claimed-999993-boot-999993"))

    const next = createTestRecorder({ dir, pid: 131_313, startAt: T0 + STALE })
    await next.summary.recover()

    expect(readdirSync(base).filter((name) => name.includes(".tmp") || name.includes(".claimed-"))).toEqual([])
    expect(rows(next.published)).toEqual([[0, "recovered", 1]])
  })

  test("#given a dead process's own-copy window #when it is recovered #then it is sent once and no empty own-copy file is left behind", async () => {
    const dir = stateDirs.make()
    const owner = createTestRecorder({ dir, pid: 141_414, alivePids: [151_515], startAt: T0 })
    const copier = createTestRecorder({ dir, pid: 151_515, alivePids: [141_414], startAt: T0 })
    await owner.summary.recordTurn("s1", summaryTurn())
    await copier.summary.recordTurn("s1", summaryTurn({ turnIndex: 1 }))
    const ownCopy = join(summaryDir(dir), "s1@boot-151515.json")
    expect(existsSync(ownCopy)).toBe(true)

    const sweeper = createTestRecorder({ dir, pid: 161_616, alivePids: [141_414], startAt: T0 + STALE })
    await sweeper.summary.recover()

    expect(rows(sweeper.published).map(([, endedBy, turns]) => [endedBy, turns])).toEqual([["recovered", 1]])
    expect(existsSync(ownCopy)).toBe(false)
  })

  test("#given expired records whose scope has opted out #when a sweep drops them #then they are not counted in dropped_events", async () => {
    const dir = stateDirs.make()
    const optedOut = createTestRecorder({ dir, pid: 171_717, startAt: T0, ack: false, consentScope: { cwd: "/off" } })
    await optedOut.summary.recordTurn("sent", summaryTurn())
    await optedOut.summary.finish("sent", "quit")
    await optedOut.summary.recordTurn("open", summaryTurn())
    expect(optedOut.storage.pendingUuids()).toHaveLength(1)

    const later = createTestRecorder({
      dir, pid: 181_818, startAt: T0 + SUMMARY_TTL_MS + 1, consentScope: { cwd: "/on" }, isScopeConsented: (scope) => scope.cwd !== "/off",
    })
    await later.summary.recordTurn("s2", summaryTurn())
    await later.summary.finish("s2", "quit")

    expect(later.storage.pendingUuids()).toEqual([])
    expect(later.storage.windowKeys()).not.toContain("open")
    expect(later.published.map(({ properties }) => properties.dropped_events)).toEqual([0])
  })

  test("#given a dead owner's queued records from an opted-out scope #when an opted-out session purges the queue #then they are deleted at rest and opted-in ones stay", () => {
    const dir = stateDirs.make()
    const storage = createTestRecorder({ dir, pid: 191_919, startAt: T0 }).storage
    const pending = (uuid: string, cwd: string) => ({
      consent: "enabled" as const, scope: { cwd }, uuid, sessionHash: `h-${cwd}`, owner: storage.owner, createdAt: T0, properties: { turns: 1 },
    })
    storage.writePending(pending("0395eae0-1111-4222-8333-944455556661", "/off"))
    storage.writePending(pending("0395eae0-1111-4222-8333-944455556662", "/on"))
    const window = (cwd: string) => ({
      consent: "enabled" as const, scope: { cwd }, sessionHash: `w-${cwd}`, sessionRole: "root" as const, owner: storage.owner,
      heartbeatAt: T0, epoch: "0123456789abcdef", seq: 1, sampleRate: 0.05, windowId: null, window: null,
    })
    storage.writeWindow("w-off", window("/off"))
    storage.writeWindow("w-on", window("/on"))

    purgeOptedOutQueue({ stateDir: dir, isScopeConsented: (scope) => scope.cwd !== "/off", isPidAlive: (pid) => pid === process.pid })

    expect(storage.pendingUuids()).toEqual(["0395eae0-1111-4222-8333-944455556662"])
    expect(storage.windowKeys()).toEqual(["w-on"])
  })

  test("#given a checkpoint #when the window is published #then its pending file and the advanced seq were already on disk", async () => {
    const dir = stateDirs.make()
    const probe = createTestRecorder({
      dir,
      startAt: T0,
      onPublish: (event, storage) => ({
        pending: withRecoveryOps(storage).readPending(event.uuid) !== undefined,
        window: storage.readWindow(storage.windowKey("s1")),
      }),
    })
    for (let index = 0; index < CHECKPOINT_MAX_TURNS; index += 1) await probe.summary.recordTurn("s1", summaryTurn({ turnIndex: index }))

    expect(probe.observed).toEqual([{ pending: true, window: expect.objectContaining({ seq: 1, window: null, windowId: null }) }])
    expect(probe.storage.pendingUuids()).toEqual([])
  })
})

function readWindow(recorder: ReturnType<typeof createTestRecorder>, sessionHash: string) {
  const record = recorder.storage.readWindow(recorder.storage.windowKey(sessionHash))
  if (record === undefined || record === CORRUPT || record.windowId === null) throw new Error(`no open window for ${sessionHash}`)
  return { ...record, windowId: record.windowId }
}
