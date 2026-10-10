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

  // Waits on an explicit condition, bounded by a circuit breaker so a regression fails instead of hanging.
  async function eventually(check: () => boolean, label: string): Promise<void> {
    const deadline = Date.now() + 5_000
    while (!check()) {
      if (Date.now() > deadline) throw new Error(`timed out waiting for ${label}`)
      await new Promise((resolve) => setTimeout(resolve, 5))
    }
  }

  // Contract: no queued message is ever stranded. A producer that keeps queueing past the pass limit
  // still has every message delivered once it stops, with no further start or send (#9861).
  test("a queue that refills past the pass limit empties once the producer stops", async () => {
    const h = makeHarness()
    const record = h.seedRecord()
    await h.engine.sendToTask({ idOrName: record.task_id, message: "seed", deliverAs: "steer" })
    h.store.transition(record.task_id, { type: "start", timestamp: new Date(h.now()).toISOString() })
    const child = makeFakeHandle(record.task_id, "rpc")
    const delivered: string[] = []
    h.setLive(record.task_id, { ...child.handle, steer: async (message) => {
      delivered.push(message)
      // Sends that land while a drain delivers are persisted, as a parked window or revival does.
      if (delivered.length <= 40) {
        h.store.mutate(record.task_id, (fresh) => ({ ...fresh, pending_steering: [...(fresh.pending_steering ?? []),
          { id: `more-${delivered.length}`, message: `more ${delivered.length}`, deliver_as: "steer" as const }] }))
      }
    } })
    await h.engine.notifyStarted(record.task_id)
    await eventually(() => (h.store.load(record.task_id)?.pending_steering?.length ?? 0) === 0, "the queue to empty")
    expect(delivered).toHaveLength(41)
    expect(delivered.at(-1)).toBe("more 40")
  })

  // Contract: while anything is queued, a new send to a running child goes behind it, never ahead.
  test("a send to a running child with a non-empty queue is delivered after what was queued", async () => {
    const h = makeHarness()
    const record = h.seedRecord()
    h.store.transition(record.task_id, { type: "start", timestamp: new Date(h.now()).toISOString() })
    h.store.mutate(record.task_id, (fresh) => ({ ...fresh, pending_steering: [
      { id: "left-1", message: "left over 1", deliver_as: "steer" as const },
      { id: "left-2", message: "left over 2", deliver_as: "steer" as const }] }))
    const child = makeFakeHandle(record.task_id, "rpc")
    h.setLive(record.task_id, child.handle)
    const sent = await h.engine.sendToTask({ idOrName: record.task_id, message: "user next", deliverAs: "steer" })
    expect(sent.kind).toBe("queued")
    await eventually(() => child.steerCalls.length === 3, "all three deliveries")
    expect(child.steerCalls).toEqual(["left over 1", "left over 2", "user next"])
  })

  // Contract: queued entries have distinct ids, so clearing one delivered entry never drops another.
  test("a message queued during delivery is kept after a partial drain", async () => {
    const h = makeHarness()
    const record = h.seedRecord()
    await h.engine.sendToTask({ idOrName: record.task_id, message: "first", deliverAs: "steer" })
    await h.engine.sendToTask({ idOrName: record.task_id, message: "second", deliverAs: "steer" })
    h.store.mutate(record.task_id, (fresh) => ({ ...fresh, pending_steering: fresh.pending_steering?.slice(1) }))
    await h.engine.sendToTask({ idOrName: record.task_id, message: "third", deliverAs: "steer" })
    h.store.transition(record.task_id, { type: "start", timestamp: new Date(h.now()).toISOString() })
    const child = makeFakeHandle(record.task_id, "rpc")
    // "second" is refused before delivery (the drain stops and keeps it); "third" must still be queued.
    let refusedOnce = false
    h.setLive(record.task_id, { ...child.handle, steer: async (message) => {
      if (message === "second" && !refusedOnce) { refusedOnce = true; return }
      child.steerCalls.push(message)
    } })
    await h.engine.notifyStarted(record.task_id)
    await eventually(() => (h.store.load(record.task_id)?.pending_steering?.length ?? 0) === 0, "the queue to empty")
    expect(child.steerCalls).toContain("third")
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
