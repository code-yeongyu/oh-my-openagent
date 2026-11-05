import { afterEach, describe, expect, test } from "bun:test"
import { existsSync, utimesSync } from "node:fs"
import { join } from "node:path"
import { cleanupProjects, seedRecord, tempStore } from "../lifecycle/__fixtures__/lifecycle-fakes"
import type { TaskRecordStore } from "../store"
import { controlFor, fakeOwner, want, type FakeOwner } from "./__fixtures__/owner-fakes"
import { ControlInbox } from "./control-inbox"
import { controlDir, registerName } from "./control-paths"
import { readAckFile, writeRegister } from "./control-store"

const unregisters: (() => Promise<void>)[] = []
afterEach(async () => {
  for (const unregister of unregisters.splice(0)) await unregister()
  cleanupProjects()
})

const T1 = "st_00000001"
const T2 = "st_00000002"
const run = (taskId: string) => ({ parentSessionId: "parent-1", parentPauseSeq: 2, runRef: { kind: "task" as const, id: taskId } })

function host(store: TaskRecordStore, pid: number, now: () => number, owner: FakeOwner = fakeOwner(store, pid)) {
  const inbox = ControlInbox.for({ stateDir: store.stateDir, hostPid: pid, store, autoStart: false, now })
  unregisters.push(inbox.register(owner, { channel: true, liveTasks: () => owner.live.size }))
  return { owner, inbox }
}

function setup(tasks: readonly string[] = [T1]) {
  const store = tempStore()
  for (const taskId of tasks) seedRecord(store, { task_id: taskId, status: "running", run_epoch: 1, host_pid: 7201 })
  let now = 1_000_000
  const { owner, inbox } = host(store, 7201, () => now)
  for (const taskId of tasks) owner.live.add(taskId)
  return { store, owner, inbox, advance: (ms: number) => { now += ms } }
}

const ack = (store: TaskRecordStore, taskId = T1) => readAckFile(controlFor(store), taskId, "parent-1")

describe("owner inbox guard cases (design section 7)", () => {
  test("#given the owner suspends between validation and the call #when reconciled #then handle_gone and no paused write (test 18, F13)", async () => {
    const { store, owner, inbox } = setup()
    const ancestry = owner.inAncestry
    owner.inAncestry = (record, parent) => { owner.live.delete(T1); return ancestry(record, parent) }
    writeRegister(store, controlFor(store), want())
    await inbox.tick()
    expect(ack(store)).toMatchObject({ state: "refused", reason: "handle_gone" })
    expect(store.load(T1)?.status).toBe("running")
    expect(owner.calls.pause).toBe(0)
  })

  test("#given the child holds another user hold #when resumed@S is ticked twice #then held_by_user once and one resume call (test 20f)", async () => {
    const { store, owner, inbox, advance } = setup()
    await owner.pauseTask(T1, run(T1))
    let calls = 0
    owner.resumePausedTask = async () => { calls += 1; return { otherHoldLive: true, childSeq: 4 } }
    writeRegister(store, controlFor(store), want({ phase: "resumed", resumeId: "r-1" }))
    await inbox.tick()
    advance(5_000)
    await inbox.tick()
    expect(ack(store)).toMatchObject({ state: "held_by_user", childSeq: 4 })
    expect(calls).toBe(1)
  })

  test("#given the owner's own Stop over two children with guidance #when both registers land #then guidance first, both resumed once, barrier open (test 20h)", async () => {
    const { store, owner, inbox } = setup([T1, T2])
    for (const taskId of [T1, T2]) await owner.pauseTask(taskId, run(taskId))
    owner.barrier?.close("parent-1", 2)
    const order: string[] = []
    const hold = owner.holdTaskInput
    owner.holdTaskInput = async (taskId, input) => { order.push(`hold:${taskId}`); return hold(taskId, input) }
    const resume = owner.resumePausedTask
    owner.resumePausedTask = async (taskId, request) => { order.push(`resume:${taskId}`); return resume(taskId, request) }
    for (const taskId of [T1, T2]) writeRegister(store, controlFor(store), want({ taskId, runRef: { kind: "task", id: taskId },
      phase: "resumed", resumeId: "r-1", guidance: [{ inputId: `send-${taskId}`, revision: 0, text: "go" }] }))
    await inbox.tick()
    expect(owner.barrier?.state("parent-1")).toEqual({ kind: "open" })
    expect(order).toEqual([`hold:${T1}`, `resume:${T1}`, `hold:${T2}`, `resume:${T2}`])
    expect(ack(store, T2)).toMatchObject({ state: "resumed", guidance: [{ inputId: `send-${T2}`, outcome: "delivered" }] })
  })

  test("#given a throwing child inside the own-Stop release #when ticked #then the barrier still opens and the sibling resumes (test 20h, r5-4)", async () => {
    const { store, owner, inbox } = setup([T1, T2])
    for (const taskId of [T1, T2]) await owner.pauseTask(taskId, run(taskId))
    owner.barrier?.close("parent-1", 2)
    const resume = owner.resumePausedTask
    owner.resumePausedTask = async (taskId, request) => {
      if (taskId === T1) throw new Error("child transport lost")
      return resume(taskId, request)
    }
    for (const taskId of [T1, T2]) writeRegister(store, controlFor(store), want({ taskId, runRef: { kind: "task", id: taskId }, phase: "resumed", resumeId: "r-1" }))
    await inbox.tick()
    expect(owner.barrier?.state("parent-1")).toEqual({ kind: "open" })
    expect(ack(store, T2)).toMatchObject({ state: "resumed" })
    expect(ack(store, T1)).toBeUndefined()
  })

  test("#given a child whose own resumed register is backing off #when the sibling's register releases the own Stop #then that child is resumed inside the transaction (review of #12371 r2, LOW)", async () => {
    const { store, owner, inbox } = setup([T1, T2])
    for (const taskId of [T1, T2]) await owner.pauseTask(taskId, run(taskId))
    owner.barrier?.close("parent-1", 2)
    const load = owner.load
    let failNext = true
    owner.load = taskId => {
      if (taskId === T1 && failNext) { failNext = false; throw new Error("record read failed") }
      return load(taskId)
    }
    writeRegister(store, controlFor(store), want({ phase: "resumed", resumeId: "r-1" }))
    await inbox.tick()
    expect(store.load(T1)?.status).toBe("paused")
    writeRegister(store, controlFor(store), want({ taskId: T2, runRef: { kind: "task", id: T2 }, phase: "resumed", resumeId: "r-1" }))
    await inbox.tick()
    expect(owner.barrier?.state("parent-1")).toEqual({ kind: "open" })
    expect(ack(store, T1)).toMatchObject({ state: "resumed" })
    expect(ack(store, T2)).toMatchObject({ state: "resumed" })
  })

  test("#given a register landing after the owner's listing #when the release ran #then that child stays paused and resumes once on a later tick (test 20h, r6-2)", async () => {
    const { store, owner, inbox } = setup([T1, T2])
    for (const taskId of [T1, T2]) await owner.pauseTask(taskId, run(taskId))
    owner.barrier?.close("parent-1", 2)
    writeRegister(store, controlFor(store), want({ phase: "resumed", resumeId: "r-1" }))
    await inbox.tick()
    expect(store.load(T2)?.status).toBe("paused")
    writeRegister(store, controlFor(store), want({ taskId: T2, runRef: { kind: "task", id: T2 }, phase: "resumed", resumeId: "r-1" }))
    await inbox.tick()
    expect(ack(store, T2)).toMatchObject({ state: "resumed" })
    expect(owner.calls.resume).toBe(2)
  })

  test("#given a flag-less cancel answered cancel_pending #when it keeps answering so #then the register waits with no owner_failed (test 20c)", async () => {
    const { store, owner, inbox, advance } = setup()
    owner.cancelAnswer = taskId => ({ kind: "cancel_pending", task_id: taskId, previous_status: "running", reason: "recovering" })
    writeRegister(store, controlFor(store), want({ phase: "cancelled", cancel: { requestedAt: new Date(0).toISOString() } }))
    for (let attempt = 0; attempt < 12; attempt += 1) { await inbox.tick(); advance(61_000) }
    expect(ack(store)).toBeUndefined()
    expect(owner.calls.cancel.length).toBeGreaterThanOrEqual(12)
  })

  test("#given a cancel-final record whose cancel keeps throwing #when ticked past ten attempts #then it is still retried, never owner_failed (test 20c)", async () => {
    const { store, owner, inbox, advance } = setup()
    store.mutate(T1, fresh => ({ ...fresh, cancel_requested: { requested_at: new Date(0).toISOString() } }))
    owner.cancelTask = async () => { throw new Error("host unreachable") }
    writeRegister(store, controlFor(store), want())
    for (let attempt = 0; attempt < 12; attempt += 1) { await inbox.tick(); advance(61_000) }
    expect(ack(store)).toBeUndefined()
  })

  test("#given a cancel-final child inside the own-Stop release #when the sibling's register triggers it #then that child is never resumed and is cancelled (test 20c, r7-1)", async () => {
    const { store, owner, inbox, advance } = setup([T1, T2])
    for (const taskId of [T1, T2]) await owner.pauseTask(taskId, run(taskId))
    owner.barrier?.close("parent-1", 2)
    writeRegister(store, controlFor(store), want({ taskId: T2, runRef: { kind: "task", id: T2 }, phase: "resumed", resumeId: "r-1" }))
    advance(1)
    store.mutate(T1, fresh => ({ ...fresh, cancel_requested: { requested_at: new Date(0).toISOString() } }))
    utimesSync(join(controlDir(store.stateDir), registerName(T2, "parent-1")), new Date(1000), new Date(1000))
    writeRegister(store, controlFor(store), want({ phase: "resumed", resumeId: "r-1" }))
    const resumed: string[] = []
    const resume = owner.resumePausedTask
    owner.resumePausedTask = async (taskId, request) => { resumed.push(taskId); return resume(taskId, request) }
    await inbox.tick()
    expect(resumed).toEqual([T2])
    expect(ack(store, T1)).toMatchObject({ state: "cancelled" })
  })

  test("#given an answered cancel #when a later Stop S+1 is written #then the sticky register is not re-acted on (test 20j, owner half)", async () => {
    const { store, owner, inbox } = setup()
    writeRegister(store, controlFor(store), want({ phase: "cancelled", cancel: { requestedAt: new Date(0).toISOString() } }))
    await inbox.tick()
    writeRegister(store, controlFor(store), want({ pauseSeq: 3 }))
    await inbox.tick()
    expect(owner.calls.cancel).toHaveLength(1)
    expect(owner.calls.pause).toBe(0)
  })

  test("#given both sides restart with fresh objects over one store #when the Resume is written #then it converges to one resume (test 21, F6)", async () => {
    const { store, owner } = setup()
    writeRegister(store, controlFor(store), want())
    await ControlInbox.for({ stateDir: store.stateDir, hostPid: 7201, store }).tick()
    await unregisters.splice(0)[0]?.()
    store.mutate(T1, fresh => ({ ...fresh, host_pid: 7202 }))
    const reborn = fakeOwner(store, 7202)
    for (const [taskId, engine] of owner.engines) reborn.engines.set(taskId, engine)
    reborn.live.add(T1)
    const { inbox } = host(store, 7202, () => 2_000_000, reborn)
    writeRegister(store, controlFor(store), want({ phase: "resumed", resumeId: "r-1" }))
    await inbox.tick()
    await inbox.tick()
    expect(owner.calls.resume + reborn.calls.resume).toBe(1)
    expect(ack(store)).toMatchObject({ state: "resumed", owner: { pid: 7202 } })
  })

  test("#given control files older than a day #when the inbox sweeps #then only a terminal child's files go (test 23, GC)", async () => {
    const { store } = setup([T1, T2])
    for (const taskId of [T1, T2]) writeRegister(store, controlFor(store), want({ taskId, runRef: { kind: "task", id: taskId }, phase: "cancelled", cancel: { requestedAt: new Date(0).toISOString() } }))
    store.mutate(T2, fresh => ({ ...fresh, status: "completed" }))
    const old = new Date(0)
    for (const taskId of [T1, T2]) utimesSync(join(controlDir(store.stateDir), registerName(taskId, "parent-1")), old, old)
    await unregisters.splice(0)[0]?.()
    const later = ControlInbox.for({ stateDir: store.stateDir, hostPid: 7203, store, autoStart: false, now: () => 2 * 24 * 60 * 60 * 1000 })
    const idle = fakeOwner(store, 7203)
    unregisters.push(later.register(idle, { channel: true, liveTasks: () => 0 }))
    await later.tick()
    expect(existsSync(join(controlDir(store.stateDir), registerName(T2, "parent-1")))).toBe(false)
    expect(existsSync(join(controlDir(store.stateDir), registerName(T1, "parent-1")))).toBe(true)
  })
})
