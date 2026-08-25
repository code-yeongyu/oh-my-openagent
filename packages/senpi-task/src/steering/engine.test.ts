import { readFileSync, writeFileSync } from "node:fs"
import { join } from "node:path"

import { afterEach, describe, expect, test } from "bun:test"

import type { ManagedChildHandle } from "../manager/child-handle"
import type { TaskRecord } from "../state"
import { createTaskRecordStore } from "../store"
import type { TaskRecordStore } from "../store"
import {
  cleanupSteering,
  makeFakeDestruction,
  makeFakeHandle,
  makeHarness,
  type RunnerFlavor,
  type SteeringHarness,
} from "./__fixtures__/steering-fakes"
import { createSteeringEngine } from "./engine"
import type { SteeringEngine } from "./types"

afterEach(cleanupSteering)

function toRunning(harness: SteeringHarness, record: TaskRecord): void {
  harness.store.transition(record.task_id, { type: "start", timestamp: new Date().toISOString() })
}

function toCompleted(harness: SteeringHarness, record: TaskRecord): void {
  toRunning(harness, record)
  harness.store.transition(record.task_id, { type: "complete", timestamp: new Date().toISOString(), final_response: "first pass" })
}

const flavors: RunnerFlavor[] = ["in-process", "rpc"]

describe.each(flavors)("steering engine over the %s runner fake", (flavor) => {
  test("#given a running resident child #when sent a steer #then the steer lands mid-run on the live handle", async () => {
    // given
    const harness = makeHarness()
    const record = harness.seedRecord()
    toRunning(harness, record)
    const fake = makeFakeHandle(record.task_id, flavor)
    harness.setLive(record.task_id, fake.handle)

    // when
    const outcome = await harness.engine.sendToTask({ idOrName: record.task_id, message: "keep going", deliverAs: "steer" })

    // then
    expect(outcome.kind).toBe("steered")
    if (outcome.kind !== "steered") throw new Error("expected steered")
    expect(outcome.delivered).toBe("steer")
    expect(fake.steerCalls).toEqual(["keep going"])
  })

  test("#given a completed resident child #when sent a message #then it revives on the SAME instance with an incremented epoch", async () => {
    // given
    const harness = makeHarness()
    const record = harness.seedRecord()
    toCompleted(harness, record)
    const fake = makeFakeHandle(record.task_id, flavor)
    harness.setLive(record.task_id, fake.handle)

    // when
    const outcome = await harness.engine.sendToTask({ idOrName: record.task_id, message: "second pass" })

    // then
    if (outcome.kind !== "revived") throw new Error("expected revived")
    expect(outcome.run_epoch).toBe(1)
    expect(fake.followUpCalls).toEqual(["second pass"])
    const revived = harness.store.load(record.task_id)
    expect(revived?.status).toBe("running")
    expect(revived?.residency_state).toBe("resident")
    expect(revived?.notification.run_epoch).toBe(1)
    expect(harness.reviveCalls).toContain(record.task_id)
  })

  test("#given a running resident child #when interrupted then sent #then interrupt keeps partial text and the later send revives", async () => {
    // given
    const harness = makeHarness()
    const record = harness.seedRecord()
    toRunning(harness, record)
    const fake = makeFakeHandle(record.task_id, flavor)
    fake.setLastAssistantText("partial answer so far")
    harness.setLive(record.task_id, fake.handle)

    // when
    const interrupted = await harness.engine.interruptTask(record.task_id)

    // then
    if (interrupted.kind !== "interrupted") throw new Error("expected interrupted")
    expect(interrupted.previous_status).toBe("running")
    expect(fake.abortCalls).toHaveLength(1)
    const afterInterrupt = harness.store.load(record.task_id)
    expect(afterInterrupt?.status).toBe("interrupted")
    expect(afterInterrupt?.final_response).toBe("partial answer so far")

    // when (send after interrupt works -> revive)
    const sent = await harness.engine.sendToTask({ idOrName: record.task_id, message: "resume please" })

    // then
    expect(sent.kind).toBe("revived")
    expect(fake.followUpCalls).toEqual(["resume please"])
  })

  test("#given a running resident child #when cancelled then sent #then destruction runs once and the send is not continuable", async () => {
    // given
    const harness = makeHarness()
    const record = harness.seedRecord()
    toRunning(harness, record)
    const fake = makeFakeHandle(record.task_id, flavor)
    harness.setLive(record.task_id, fake.handle)

    // when
    const cancelled = await harness.engine.cancelTask(record.task_id, "user aborted")

    // then
    if (cancelled.kind !== "cancelled") throw new Error("expected cancelled")
    expect(cancelled.previous_status).toBe("running")
    expect(fake.abortCalls).toHaveLength(1)
    expect(harness.destruction.calls).toEqual([{ taskId: record.task_id, cause: "cancel" }])
    expect(harness.store.load(record.task_id)?.status).toBe("cancelled")

    // when (send after cancel)
    const sent = await harness.engine.sendToTask({ idOrName: record.task_id, message: "one more" })

    // then
    expect(sent.kind).toBe("not_continuable")
  })

  test("#given a running child whose abort rejects #when cancelled #then destruction still runs exactly once and the cancel resolves", async () => {
    // given (rpc child already exited: protocol-client rejects the abort send)
    const harness = makeHarness()
    const record = harness.seedRecord()
    toRunning(harness, record)
    const fake = makeFakeHandle(record.task_id, flavor, { abortRejects: true })
    harness.setLive(record.task_id, fake.handle)

    // when
    const cancelled = await harness.engine.cancelTask(record.task_id, "user aborted")

    // then (abort rejection does NOT skip appendEvent + destruction; record is not a resident zombie)
    if (cancelled.kind !== "cancelled") throw new Error("expected cancelled")
    expect(cancelled.previous_status).toBe("running")
    expect(fake.abortCalls).toHaveLength(1)
    expect(harness.destruction.calls).toEqual([{ taskId: record.task_id, cause: "cancel" }])
    expect(harness.store.load(record.task_id)?.status).toBe("cancelled")
  })

  test("#given a cancelled child #when cancelled again #then it is an idempotent no-op and destruction is not re-run", async () => {
    // given
    const harness = makeHarness()
    const record = harness.seedRecord()
    toRunning(harness, record)
    const fake = makeFakeHandle(record.task_id, flavor)
    harness.setLive(record.task_id, fake.handle)
    await harness.engine.cancelTask(record.task_id)

    // when
    const second = await harness.engine.cancelTask(record.task_id)

    // then
    expect(second.kind).toBe("noop")
    expect(harness.destruction.calls).toHaveLength(1)
  })

  test("#given a pending child #when two messages are sent #then they queue and deliver in order right after start", async () => {
    // given
    const harness = makeHarness()
    const record = harness.seedRecord()
    const first = await harness.engine.sendToTask({ idOrName: record.task_id, message: "first" })
    const second = await harness.engine.sendToTask({ idOrName: record.task_id, message: "second" })

    // then (queued while pending)
    if (first.kind !== "queued" || second.kind !== "queued") throw new Error("expected queued")
    expect(first.queue_position).toBe(1)
    expect(second.queue_position).toBe(2)

    // when (task starts and gets a live handle)
    const fake = makeFakeHandle(record.task_id, flavor)
    harness.setLive(record.task_id, fake.handle)
    await harness.engine.notifyStarted(record.task_id)

    // then (ordered delivery)
    expect(fake.followUpCalls).toEqual(["first", "second"])
  })
})

describe("steering engine scope + resolution guards", () => {
  test("#given a task owned by another session #when sent without all_scope #then it is scope-denied naming the owning session", async () => {
    // given
    const harness = makeHarness()
    const record = harness.seedRecord({ parent_session_id: "parent-1", root_session_id: "parent-1" })
    toRunning(harness, record)
    harness.setLive(record.task_id, makeFakeHandle(record.task_id, "in-process").handle)

    // when
    const outcome = await harness.engine.sendToTask({ idOrName: record.task_id, message: "hi", callerSessionId: "parent-2" })

    // then
    if (outcome.kind !== "scope_denied") throw new Error("expected scope_denied")
    expect(outcome.owning_session_id).toBe("parent-1")
  })

  test("#given a cross-session task #when sent with all_scope #then delivery is allowed", async () => {
    // given
    const harness = makeHarness()
    const record = harness.seedRecord({ parent_session_id: "parent-1", root_session_id: "parent-1" })
    toRunning(harness, record)
    const fake = makeFakeHandle(record.task_id, "in-process")
    harness.setLive(record.task_id, fake.handle)

    // when
    const outcome = await harness.engine.sendToTask({ idOrName: record.task_id, message: "hi", callerSessionId: "parent-2", allScope: true })

    // then
    expect(outcome.kind).toBe("steered")
  })

  test("#given an unknown selector #when sent #then it reports not_found", async () => {
    // given
    const harness = makeHarness()

    // when
    const outcome = await harness.engine.sendToTask({ idOrName: "st_0000dead", message: "hi" })

    // then
    expect(outcome.kind).toBe("not_found")
    if (outcome.kind !== "not_found") throw new Error("expected not_found")
    expect(outcome.suggestion).toContain("/tasks")
    expect(outcome.suggestion).toContain("task_output")
    expect(outcome.suggestion).not.toContain("task_list")
  })

  test("#given a task resolved by name #when sent a steer #then the name resolves to the record", async () => {
    // given
    const harness = makeHarness()
    const record = harness.seedRecord({ name: "researcher" })
    toRunning(harness, record)
    const fake = makeFakeHandle(record.task_id, "in-process")
    harness.setLive(record.task_id, fake.handle)

    // when
    const outcome = await harness.engine.sendToTask({ idOrName: "researcher", message: "go", deliverAs: "steer" })

    // then
    expect(outcome.kind).toBe("steered")
    expect(fake.steerCalls).toEqual(["go"])
  })
})

describe("steering pending cancellation", () => {
  test("#given a pending child with queued sends w2pend #when cancelled then notified started #then the queue is dropped without delivery", async () => {
    // given
    const harness = makeHarness()
    const record = harness.seedRecord()
    const live = new Map<string, ManagedChildHandle>()
    const dequeued: string[] = []
    const destroyed: string[] = []
    const engine = createSteeringEngine({
      store: harness.store,
      liveHandle: (taskId) => live.get(taskId),
      reserveForRevive: () => ({ ok: true, commit: () => undefined, release: () => undefined }),
      dequeuePending: (taskId) => {
        dequeued.push(taskId)
        return true
      },
      runStatsSnapshot: () => undefined,
      destruction: {
        destroyResidentTask: async (taskId) => {
          destroyed.push(taskId)
        },
      },
      now: Date.now,
    })
    await engine.sendToTask({ idOrName: record.task_id, message: "first" })
    await engine.sendToTask({ idOrName: record.task_id, message: "second" })

    // when
    const cancelled = await engine.cancelTask(record.task_id, "not needed")
    const fake = makeFakeHandle(record.task_id, "in-process")
    live.set(record.task_id, fake.handle)
    await engine.notifyStarted(record.task_id)

    // then
    if (cancelled.kind !== "cancelled") throw new Error("expected cancelled")
    expect(cancelled.previous_status).toBe("pending")
    expect(harness.store.load(record.task_id)?.status).toBe("cancelled")
    expect(dequeued).toEqual([record.task_id])
    expect(destroyed).toEqual([record.task_id])
    expect(fake.followUpCalls).toEqual([])
    expect(fake.steerCalls).toEqual([])
  })

  test("#given a pending child w2pend #when interrupted #then it remains pending with a noop outcome", async () => {
    // given
    const harness = makeHarness()
    const record = harness.seedRecord()

    // when
    const interrupted = await harness.engine.interruptTask(record.task_id)

    // then
    expect(interrupted.kind).toBe("noop")
    expect(harness.store.load(record.task_id)?.status).toBe("pending")
  })

  test("#given a pending child with queued sends w2pend #when dropPending then notified started #then buffered messages are discarded", async () => {
    // given a queued task with two buffered (durably persisted) messages
    const harness = makeHarness()
    const record = harness.seedRecord()
    await harness.engine.sendToTask({ idOrName: record.task_id, message: "first" })
    await harness.engine.sendToTask({ idOrName: record.task_id, message: "second" })
    expect(harness.store.load(record.task_id)?.pending_steering).toHaveLength(2)

    // when the manager forgets the task before it ever launches, then a stale start fires
    harness.engine.dropPending(record.task_id)
    const fake = makeFakeHandle(record.task_id, "in-process")
    harness.setLive(record.task_id, fake.handle)
    await harness.engine.notifyStarted(record.task_id)

    // then nothing is delivered and the persisted queue is released, not retained for the session
    expect(fake.followUpCalls).toEqual([])
    expect(fake.steerCalls).toEqual([])
    expect(harness.store.load(record.task_id)?.pending_steering ?? []).toEqual([])
  })
})

describe("durable prelaunch steering", () => {
  // Simulated process restart: a fresh store + fresh engine over the SAME state dir. Nothing
  // in-memory survives, so anything the new engine delivers must have come from the record.
  function restartHarness(stateDir: string): {
    readonly engine: SteeringEngine
    readonly live: Map<string, ManagedChildHandle>
    readonly store: TaskRecordStore
  } {
    const store = createTaskRecordStore({ project_dir: "", task: { state_dir: stateDir } })
    const live = new Map<string, ManagedChildHandle>()
    const engine = createSteeringEngine({
      store,
      liveHandle: (taskId) => live.get(taskId),
      reserveForRevive: () => ({ ok: true, commit: () => undefined, release: () => undefined }),
      dequeuePending: () => false,
      runStatsSnapshot: () => undefined,
      destruction: makeFakeDestruction(),
      now: Date.now,
    })
    return { engine, live, store }
  }

  function orderTrackingHandle(taskId: string): { readonly handle: ManagedChildHandle; readonly order: string[] } {
    const fake = makeFakeHandle(taskId, "in-process")
    const order: string[] = []
    const handle: ManagedChildHandle = {
      ...fake.handle,
      steer: async (text) => {
        order.push(`steer:${text}`)
        await fake.handle.steer(text)
      },
      followUp: async (text) => {
        order.push(`followUp:${text}`)
        await fake.handle.followUp(text)
      },
    }
    return { handle, order }
  }

  test("#given a pending child with two queued sends #when a fresh engine starts over the same store and the child launches #then both messages drain in persisted order", async () => {
    // given
    const harness = makeHarness()
    const record = harness.seedRecord()
    const first = await harness.engine.sendToTask({ idOrName: record.task_id, message: "first", deliverAs: "steer" })
    const second = await harness.engine.sendToTask({ idOrName: record.task_id, message: "second" })

    // then (queued while pending, with stable positions)
    if (first.kind !== "queued" || second.kind !== "queued") throw new Error("expected queued")
    expect(first.queue_position).toBe(1)
    expect(second.queue_position).toBe(2)

    // and the queue is durable on the record, in order, with per-entry delivery preserved
    const persisted = harness.store.load(record.task_id)
    expect(persisted?.pending_steering?.map((entry) => entry.message)).toEqual(["first", "second"])
    expect(persisted?.pending_steering?.[0]?.deliver_as).toBe("steer")
    expect(persisted?.pending_steering?.[1]?.deliver_as).toBe("followUp")

    // when (process restart: fresh store + engine over the same state dir, then the child launches)
    const restarted = restartHarness(harness.store.stateDir)
    const tracked = orderTrackingHandle(record.task_id)
    restarted.live.set(record.task_id, tracked.handle)
    await restarted.engine.notifyStarted(record.task_id)

    // then (both messages delivered in persisted order, each with its recorded delivery)
    expect(tracked.order).toEqual(["steer:first", "followUp:second"])

    // and the durable queue is cleared after the drain
    expect(restarted.store.load(record.task_id)?.pending_steering ?? []).toEqual([])
  })

  test("#given a pending child with queued sends #when cancelled #then the persisted queue is cleared and a post-restart start delivers nothing", async () => {
    // given
    const harness = makeHarness()
    const record = harness.seedRecord()
    await harness.engine.sendToTask({ idOrName: record.task_id, message: "first" })
    await harness.engine.sendToTask({ idOrName: record.task_id, message: "second" })
    expect(harness.store.load(record.task_id)?.pending_steering).toHaveLength(2)

    // when
    const cancelled = await harness.engine.cancelTask(record.task_id, "not needed")

    // then
    if (cancelled.kind !== "cancelled") throw new Error("expected cancelled")
    expect(harness.store.load(record.task_id)?.pending_steering ?? []).toEqual([])

    // and when a stale start notification arrives after a restart, nothing delivers
    const restarted = restartHarness(harness.store.stateDir)
    const tracked = orderTrackingHandle(record.task_id)
    restarted.live.set(record.task_id, tracked.handle)
    await restarted.engine.notifyStarted(record.task_id)
    expect(tracked.order).toEqual([])
  })

  test("#given a running child suspended to persisted_only #when sent #then it is not_continuable with the suspended reason copy and NO revive", async () => {
    // given (session shutdown suspended the resident: status kept, residency persisted_only)
    const harness = makeHarness()
    const record = harness.seedRecord()
    toRunning(harness, record)
    harness.store.transition(record.task_id, { type: "persist_only", timestamp: new Date().toISOString() })

    // when
    const outcome = await harness.engine.sendToTask({ idOrName: record.task_id, message: "wake up" })

    // then (no lazy revive-on-send: resume the session instead)
    if (outcome.kind !== "not_continuable") throw new Error("expected not_continuable")
    expect(outcome.reason).toContain("suspended - resumes when its session is resumed")
    expect(harness.store.load(record.task_id)?.status).toBe("running")
  })

  test("#given a running child suspended to rpc_detached #when sent #then it is not_continuable with the suspended reason copy", async () => {
    // given
    const harness = makeHarness()
    const record = harness.seedRecord()
    toRunning(harness, record)
    harness.store.transition(record.task_id, { type: "detach_rpc", timestamp: new Date().toISOString() })

    // when
    const outcome = await harness.engine.sendToTask({ idOrName: record.task_id, message: "wake up" })

    // then
    if (outcome.kind !== "not_continuable") throw new Error("expected not_continuable")
    expect(outcome.reason).toContain("suspended - resumes when its session is resumed")
  })

  test("#given a persisted queue with one malformed entry #when the child starts after a restart #then the bad entry is dropped with a parse warning and the rest deliver in order", async () => {
    // given a pending record whose on-disk queue carries one corrupt entry between two valid ones
    const harness = makeHarness()
    const record = harness.seedRecord()
    const recordPath = join(harness.store.stateDir, "tasks", `${record.task_id}.json`)
    const onDisk: Record<string, unknown> = JSON.parse(readFileSync(recordPath, "utf8"))
    onDisk["pending_steering"] = [
      { id: "ps-1", message: "first", deliver_as: "followUp" },
      { id: "ps-2" },
      { id: "ps-3", message: "third", deliver_as: "steer" },
    ]
    writeFileSync(recordPath, JSON.stringify(onDisk), "utf8")

    // when a fresh store parses the corrupted record (todo-2 entry-drop policy)
    const restarted = restartHarness(harness.store.stateDir)
    const listed = restarted.store.list()

    // then the malformed ENTRY is dropped with a diagnostic while the record stays listed
    expect(listed.records.map((entry) => entry.task_id)).toContain(record.task_id)
    expect(
      listed.diagnostics.some(
        (diagnostic) => diagnostic.type === "parse_warning" && diagnostic.message.includes("pending_steering[1]"),
      ),
    ).toBe(true)

    // and when the child launches, the surviving entries deliver in order
    const tracked = orderTrackingHandle(record.task_id)
    restarted.live.set(record.task_id, tracked.handle)
    await restarted.engine.notifyStarted(record.task_id)
    expect(tracked.order).toEqual(["followUp:first", "steer:third"])

    // and the drain rewrote the record clean (corrupt entry gone for good)
    expect(restarted.store.load(record.task_id)?.pending_steering ?? []).toEqual([])
  })
})
