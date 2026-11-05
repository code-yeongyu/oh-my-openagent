import { afterEach, describe, expect, test } from "bun:test"
import { cleanupProjects, seedRecord, tempStore } from "../lifecycle/__fixtures__/lifecycle-fakes"
import type { TaskRecordStore } from "../store"
import { controlFor, fakeOwner, want, type FakeOwner } from "./__fixtures__/owner-fakes"
import { ControlInbox } from "./control-inbox"
import { writeControlFile } from "./control-fs"
import { controlDir, registerName } from "./control-paths"
import type { ControlRegister } from "./control-schema"
import { readAckFile, readRegister, writeRegister } from "./control-store"

const unregisters: (() => Promise<void>)[] = []
afterEach(async () => {
  for (const unregister of unregisters.splice(0)) await unregister()
  cleanupProjects()
})

const HOST = 7001

function setup(input: { readonly status?: "running" | "paused"; readonly hostPid?: number; readonly ancestors?: readonly string[] } = {}) {
  const store = tempStore()
  seedRecord(store, { task_id: "st_00000001", status: input.status ?? "running", run_epoch: 1, host_pid: input.hostPid ?? HOST })
  const owner = fakeOwner(store, HOST, input.ancestors === undefined ? {} : { ancestors: input.ancestors })
  owner.live.add("st_00000001")
  let now = 1_000_000
  const inbox = ControlInbox.for({ stateDir: store.stateDir, hostPid: HOST, store, autoStart: false, now: () => now })
  unregisters.push(inbox.register(owner, { channel: true, liveTasks: () => owner.live.size }))
  return { store, owner, inbox, control: controlFor(store), advance: (ms: number) => { now += ms } }
}

const send = (store: TaskRecordStore, register: ControlRegister) => writeRegister(store, controlFor(store), register)
const ack = (store: TaskRecordStore) => readAckFile(controlFor(store), "st_00000001", "parent-1")

describe("owner inbox reconcile (design 3.3)", () => {
  test("#given paused@S then resumed@S #when the owner ticks #then one pause, one resume, acks held then resumed (test 10)", async () => {
    const { store, owner, inbox } = setup()
    send(store, want())
    await inbox.tick()
    expect(ack(store)).toMatchObject({ state: "held", pauseSeq: 2 })
    send(store, want({ phase: "resumed", resumeId: "r-1" }))
    await inbox.tick()
    expect(ack(store)).toMatchObject({ state: "resumed", resumeId: "r-1" })
    send(store, want({ phase: "resumed", resumeId: "r-1", guidance: [{ inputId: "send-1", revision: 0, text: "late" }] }))
    await inbox.tick()
    expect(owner.calls).toMatchObject({ pause: 1, resume: 1 })
    expect(ack(store)).toMatchObject({ state: "resumed", guidance: [{ inputId: "send-1", outcome: "undelivered" }] })
  })

  test("#given guidance, Stop and Resume all written before the first tick #when the owner ticks #then pause, hold, resume once (test 6)", async () => {
    const { store, owner, inbox } = setup()
    send(store, want({ phase: "resumed", resumeId: "r-1", guidance: [{ inputId: "send-1", revision: 0, text: "hi" }] }))
    await inbox.tick()
    expect(owner.calls.pause).toBe(1)
    expect(owner.calls.hold).toEqual(["st_00000001:send-1"])
    expect(owner.calls.resume).toBe(1)
  })

  test("#given a register below the record's held seq #when reconciled #then refused stale and nothing resumed (test 13)", async () => {
    const { store, owner, inbox } = setup()
    send(store, want({ pauseSeq: 5 }))
    await inbox.tick()
    writeControlFile(controlDir(store.stateDir), registerName("st_00000001", "parent-1"),
      JSON.stringify(want({ pauseSeq: 3, phase: "resumed", resumeId: "r-old" })), controlFor(store).env)
    await inbox.tick()
    expect(ack(store)).toMatchObject({ state: "refused", reason: "stale", pauseSeq: 3 })
    expect(owner.calls.resume).toBe(0)
  })

  test("#given a spoofed parent outside the ancestry on an unheld child #when reconciled #then not_in_ancestry, no pause (test 14)", async () => {
    const { store, owner, inbox } = setup()
    send(store, want({ parentSessionId: "intruder" }))
    await inbox.tick()
    expect(readAckFile(controlFor(store), "st_00000001", "intruder")).toMatchObject({ state: "refused", reason: "not_in_ancestry" })
    expect(owner.calls.pause).toBe(0)
  })

  test("#given a flag-less cancelled register at an older epoch #when reconciled #then epoch_moved, register deleted, child untouched (test 11b)", async () => {
    const { store, owner, inbox, control } = setup()
    store.mutate("st_00000001", fresh => ({ ...fresh, notification: { ...fresh.notification, run_epoch: 2 } }))
    send(store, want({ phase: "cancelled", cancel: { requestedAt: new Date(0).toISOString() } }))
    await inbox.tick()
    expect(ack(store)).toMatchObject({ state: "refused", reason: "epoch_moved" })
    expect(readRegister(control, registerName("st_00000001", "parent-1")).kind).toBe("absent")
    expect(owner.calls.cancel).toHaveLength(0)
  })

  test("#given a cancel-final record whose epoch moved #when any register reaches it #then the owner cancels unfenced once (test 20c)", async () => {
    const { store, owner, inbox } = setup()
    send(store, want())
    store.mutate("st_00000001", fresh => ({ ...fresh, notification: { ...fresh.notification, run_epoch: 3 },
      cancel_requested: { requested_at: new Date(0).toISOString(), reason: "user" } }))
    await inbox.tick()
    expect(owner.calls.cancel).toHaveLength(1)
    expect(ack(store)).toMatchObject({ state: "cancelled" })
  })

  test("#given the owner's cancel answers cancel_pending #when ticked #then no ack, no owner_failed, then cancelled once terminal (test 20c)", async () => {
    const { store, owner, inbox, advance } = setup()
    store.mutate("st_00000001", fresh => ({ ...fresh, cancel_requested: { requested_at: new Date(0).toISOString() } }))
    owner.cancelAnswer = taskId => ({ kind: "cancel_pending", task_id: taskId, previous_status: "running", reason: "recovering" })
    send(store, want({ phase: "cancelled", cancel: { requestedAt: new Date(0).toISOString() } }))
    for (let attempt = 0; attempt < 12; attempt += 1) { await inbox.tick(); advance(61_000) }
    expect(ack(store)).toBeUndefined()
    owner.cancelAnswer = undefined
    await inbox.tick()
    expect(ack(store)).toMatchObject({ state: "cancelled" })
  })

  test("#given the child settled before the cancel tick #when reconciled #then ack settled (test 20i)", async () => {
    const { store, inbox } = setup()
    store.mutate("st_00000001", fresh => ({ ...fresh, status: "completed" }))
    send(store, want({ phase: "cancelled", cancel: { requestedAt: new Date(0).toISOString() } }))
    await inbox.tick()
    expect(ack(store)).toMatchObject({ state: "settled" })
  })

  test("#given a register for a task this process records but no manager holds #when ticked #then handle_gone once (test 20d)", async () => {
    const { store, owner, inbox } = setup()
    owner.live.delete("st_00000001")
    owner.live.add("st_other")
    send(store, want())
    await inbox.tick()
    expect(ack(store)).toMatchObject({ state: "refused", reason: "handle_gone" })
    expect(owner.calls.pause).toBe(0)
  })

  test("#given the child engine has no native pause #when reconciled #then native_pause_unavailable on the first attempt (17c)", async () => {
    const { store, owner, inbox } = setup()
    owner.pauseError = Object.assign(new Error("no native pause"), { code: "native_pause_unavailable" })
    send(store, want())
    await inbox.tick()
    expect(ack(store)).toMatchObject({ state: "refused", reason: "native_pause_unavailable" })
  })

  test("#given a failing register #when it keeps failing #then backoff then owner_failed after ten attempts (F14)", async () => {
    const { store, owner, inbox, advance } = setup()
    owner.pauseError = new Error("transport down")
    send(store, want())
    for (let attempt = 0; attempt < 9; attempt += 1) { await inbox.tick(); advance(61_000) }
    expect(ack(store)).toBeUndefined()
    await inbox.tick()
    expect(ack(store)).toMatchObject({ state: "refused", reason: "owner_failed" })
  })

  test("#given the owner's own newer Stop #when resumed@S arrives #then owner_held, never stale (tests 19, 20g)", async () => {
    const { store, owner, inbox } = setup()
    owner.barrier?.close("parent-1", 9)
    send(store, want({ phase: "resumed", resumeId: "r-1" }))
    await inbox.tick()
    expect(ack(store)).toMatchObject({ state: "held_by_user", reason: "owner_held" })
  })

  test("#given the owner's own Stop at S' <= S #when the requester's resumed@S lands #then the barrier opens and the child resumes once (F12)", async () => {
    const { store, owner, inbox } = setup()
    await owner.pauseTask("st_00000001", { parentSessionId: "parent-1", parentPauseSeq: 2, runRef: { kind: "task", id: "st_00000001" } })
    owner.barrier?.close("parent-1", 2)
    send(store, want({ phase: "resumed", resumeId: "r-1" }))
    await inbox.tick()
    expect(owner.barrier?.state("parent-1")).toEqual({ kind: "open" })
    expect(owner.calls.resume).toBe(1)
    expect(ack(store)).toMatchObject({ state: "resumed" })
  })
})
