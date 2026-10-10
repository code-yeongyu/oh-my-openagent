import { afterEach, describe, expect, test } from "bun:test"
import { HostSessionDetachedError, SessionHeldElsewhereError } from "../runners/rpc-host/session-wire"
import { cleanupSteering, makeFakeHandle, makeHarness } from "./__fixtures__/steering-fakes"

afterEach(cleanupSteering)

describe("steering a recovering child (#9861)", () => {
  for (const error of [
    new HostSessionDetachedError("steer"),
    new SessionHeldElsewhereError("/tmp/child.jsonl", { owner: "draining-generation" }, "draining"),
  ]) {
    test(`${error.code} before delivery queues once, then delivers after revival`, async () => {
      const h = makeHarness()
      const record = h.seedRecord({ execution_mode: "process" })
      h.store.transition(record.task_id, { type: "start", timestamp: new Date(h.now()).toISOString() })
      const child = makeFakeHandle(record.task_id, "rpc")
      h.setLive(record.task_id, { ...child.handle, steer: async () => { throw error } })

      const sent = await h.engine.sendToTask({ idOrName: record.task_id, message: "updated scope", deliverAs: "steer" })
      expect(sent.kind).toBe("queued")
      expect(h.store.load(record.task_id)?.pending_steering?.map((entry) => entry.message)).toEqual(["updated scope"])
      expect(h.destruction.calls).toEqual([{ taskId: record.task_id, cause: "revive_failure" }])

      h.setLive(record.task_id, child.handle)
      h.store.mutate(record.task_id, (fresh) => ({ ...fresh, residency_state: "resident" }))
      await Promise.all([h.engine.notifyStarted(record.task_id), h.engine.notifyStarted(record.task_id)])
      expect(child.steerCalls).toEqual(["updated scope"])
      expect(h.store.load(record.task_id)?.pending_steering).toBeUndefined()
    })
  }

  test("a refused queued delivery is retained, not silently dropped", async () => {
    const h = makeHarness()
    const record = h.seedRecord()
    await h.engine.sendToTask({ idOrName: record.task_id, message: "first", deliverAs: "steer" })
    await h.engine.sendToTask({ idOrName: record.task_id, message: "second", deliverAs: "steer" })
    h.store.transition(record.task_id, { type: "start", timestamp: new Date(h.now()).toISOString() })
    const child = makeFakeHandle(record.task_id, "rpc")
    h.setLive(record.task_id, { ...child.handle, steer: async () => { throw new HostSessionDetachedError("steer") } })
    await h.engine.notifyStarted(record.task_id)
    expect(h.store.load(record.task_id)?.pending_steering?.map((entry) => entry.message)).toEqual(["first", "second"])
    h.setLive(record.task_id, child.handle)
    h.store.mutate(record.task_id, (fresh) => ({ ...fresh, residency_state: "resident" }))
    await h.engine.notifyStarted(record.task_id)
    expect(child.steerCalls).toEqual(["first", "second"])
  })

  test("an ended recovery answers with the terminal result instead of a host refusal", async () => {
    const h = makeHarness()
    const record = h.seedRecord()
    h.store.transition(record.task_id, { type: "start", timestamp: new Date(h.now()).toISOString() })
    h.store.transition(record.task_id, { type: "fail", timestamp: new Date(h.now()).toISOString(),
      error_message: "suspended_unresumable:host_draining", failure_kind: "suspended_unresumable", killed: true })
    h.store.mutate(record.task_id, (fresh) => ({ ...fresh, final_response: "retained work" }))
    const sent = await h.engine.sendToTask({ idOrName: record.task_id, message: "continue" })
    expect(sent.kind).toBe("not_continuable")
    if (sent.kind !== "not_continuable") throw new Error("expected terminal send result")
    expect(sent.reason).toContain("suspended_unresumable:host_draining")
    expect(sent.reason).toContain("retained work")
    expect(h.store.load(record.task_id)?.pending_steering).toBeUndefined()
  })
})
