import { afterEach, describe, expect, test } from "bun:test"

import type { ManagedChildHandle } from "../manager/child-handle"
import type { TaskRecord } from "../state"
import {
  cleanupSteering,
  makeFakeHandle,
  makeHarness,
  type RunnerFlavor,
  type SteeringHarness,
} from "./__fixtures__/steering-fakes"
import { createSteeringEngine } from "./engine"

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
      reacquireForRevive: () => {},
      dequeuePending: (taskId) => {
        dequeued.push(taskId)
        return true
      },
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
    // given a queued task with two buffered messages
    const harness = makeHarness()
    const record = harness.seedRecord()
    await harness.engine.sendToTask({ idOrName: record.task_id, message: "first" })
    await harness.engine.sendToTask({ idOrName: record.task_id, message: "second" })

    // when the manager forgets the task before it ever launches, then a stale start fires
    harness.engine.dropPending(record.task_id)
    const fake = makeFakeHandle(record.task_id, "in-process")
    harness.setLive(record.task_id, fake.handle)
    await harness.engine.notifyStarted(record.task_id)

    // then nothing is delivered (the buffer was released, not retained for the session)
    expect(fake.followUpCalls).toEqual([])
    expect(fake.steerCalls).toEqual([])
  })
})
