import { afterEach, describe, expect, test } from "bun:test"
import { HostSessionDetachedError, SessionHeldElsewhereError } from "../runners/rpc-host/session-wire"
import { cleanupSteering, makeFakeHandle, makeHarness } from "./__fixtures__/steering-fakes"

afterEach(cleanupSteering)

describe("steering a recovering child (#9861)", () => {
  test("a plain failure does not prevent delivery of the next queued entry", async () => {
    const h = makeHarness()
    const record = h.seedRecord()
    for (const message of ["first", "second"]) {
      await h.engine.sendToTask({ idOrName: record.task_id, message, deliverAs: "steer" })
    }
    h.store.transition(record.task_id, { type: "start", timestamp: new Date(h.now()).toISOString() })
    const attempted: string[] = []
    const child = makeFakeHandle(record.task_id, "rpc")
    h.setLive(record.task_id, { ...child.handle, steer: async (message) => {
      attempted.push(message)
      if (message === "first") throw new Error("ordinary delivery failure")
    } })
    await h.engine.notifyStarted(record.task_id)
    expect(attempted).toEqual(["first", "second"])
    expect(h.store.load(record.task_id)?.pending_steering).toBeUndefined()
  })
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
      expect(h.destruction.calls).toEqual([{ taskId: record.task_id, cause: "recovery_detach" }])

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

  // Contract: a drain always settles, even when each delivery queues another message. Before the
  // pass limit and the per-pass yield, notifyStarted never returned and starved every timer (#9861).
  test("a child whose deliveries keep queueing more messages still settles", async () => {
    const h = makeHarness()
    const record = h.seedRecord()
    await h.engine.sendToTask({ idOrName: record.task_id, message: "seed", deliverAs: "steer" })
    h.store.transition(record.task_id, { type: "start", timestamp: new Date(h.now()).toISOString() })
    const child = makeFakeHandle(record.task_id, "rpc")
    let deliveries = 0
    // A send that lands while a drain is delivering is persisted to the queue (as a revival or a
    // parked window does), not delivered inline; append one per delivery so the queue never empties.
    h.setLive(record.task_id, { ...child.handle, steer: async () => {
      deliveries += 1
      h.store.mutate(record.task_id, (fresh) => ({ ...fresh, pending_steering: [...(fresh.pending_steering ?? []),
        { id: `more-${deliveries}`, message: `more ${deliveries}`, deliver_as: "steer" as const }] }))
    } })
    let timer: ReturnType<typeof setTimeout> | undefined
    const settled = await Promise.race([
      h.engine.notifyStarted(record.task_id).then(() => "settled"),
      new Promise<string>((resolve) => { timer = setTimeout(() => resolve("drain never settled within 5 s"), 5_000) }),
    ])
    clearTimeout(timer)
    expect(settled).toBe("settled")
    expect(deliveries).toBeGreaterThan(0)
  })

  // Contract: queued entries have distinct ids, so clearing one delivered entry never drops another.
  test("a message queued during delivery is kept after a partial drain", async () => {
    const h = makeHarness()
    const record = h.seedRecord()
    await h.engine.sendToTask({ idOrName: record.task_id, message: "first", deliverAs: "steer" })
    await h.engine.sendToTask({ idOrName: record.task_id, message: "second", deliverAs: "steer" })
    h.store.mutate(record.task_id, (fresh) => ({ ...fresh, pending_steering: fresh.pending_steering?.slice(1) }))
    await h.engine.sendToTask({ idOrName: record.task_id, message: "third", deliverAs: "steer" })
    const ids = h.store.load(record.task_id)?.pending_steering?.map((entry) => entry.id) ?? []
    expect(new Set(ids).size).toBe(ids.length)
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
