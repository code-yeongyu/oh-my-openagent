import { afterEach, describe, expect, test } from "bun:test"
import { createTaskRecord } from "../state"
import { createTaskRecordStore } from "../store"
import { createOutcomeTracker } from "./manager-outcome"
import { cleanupProjects, makeHandle, tempProject } from "./__fixtures__/manager-fakes"

afterEach(cleanupProjects)

describe("pause intent outcome routing", () => {
  test("#given a pause intent before abort #when the aborted outcome settles #then park without fallback or isolation settlement", async () => {
    const store = createTaskRecordStore({ project_dir: tempProject() })
    const draft = createTaskRecord({
      parent_session_id: "parent", root_session_id: "parent", depth: 0,
      execution_mode: "in-process", model: "test/model", notify_on_terminal: true,
    })
    store.save(draft)
    store.transition(draft.task_id, { type: "start", timestamp: new Date(0).toISOString() })
    expect(store.load(draft.task_id)?.status).toBe("running")
    const fake = makeHandle(draft.task_id)
    const routed = Promise.withResolvers<void>()
    let fallback = 0
    let isolation = 0
    let parked = 0
    let released = 0
    let terminals = 0
    const pauseAcknowledged = Promise.resolve()
    const ports = {
      store, now: () => 0,
      liveHandle: () => fake.handle,
      tryLoad: () => store.load(draft.task_id) ?? null,
      runStatsSnapshot: () => undefined,
      releaseSlot: () => { released += 1 },
      parkSlot: () => { parked += 1; routed.resolve() },
      forget: () => {},
      settleWaiters: () => { terminals += 1; routed.resolve() },
      tryRuntimeFallback: async () => { fallback += 1; return false },
      settleIsolation: async () => { isolation += 1 },
      pauseSettlement: () => pauseAcknowledged,
    }
    const tracker = createOutcomeTracker(ports)
    tracker.trackOutcome(draft.task_id, fake.handle, "test/model", draft.notification.run_epoch)
    fake.settle({ status: "error", failure: { kind: "child-turn-failed", message: "aborted" } })
    await routed.promise
    expect(fallback).toBe(0)
    expect(isolation).toBe(0)
    expect(terminals).toBe(0)
    expect(released).toBe(0)
    expect(parked).toBe(1)
    expect(store.load(draft.task_id)?.status).toBe("paused")
    expect(store.load(draft.task_id)?.notification.run_epoch).toBe(draft.notification.run_epoch)
  })
})
