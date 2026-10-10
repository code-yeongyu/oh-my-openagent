import assert from "node:assert/strict"
import { coldReviveHarness } from "./cold-revive-harness"

type Terminal = "completed" | "interrupted" | "error"

export async function acknowledgedResidentContinuation(status: Terminal) {
  let fault = true
  let acknowledged = false
  const pending = [{ id: "p1", message: "PENDING", deliver_as: "steer" as const }]
  const h = coldReviveHarness({
    resume: async (_spec, _path, handle) => ({ ...handle, followUp: async (message) => {
      await handle.followUp(message)
      acknowledged = true
    } }),
    storeWrapper: (store) => ({ ...store, mutate: (id, update) => store.mutate(id, (record) => {
      const next = update(record)
      if (fault && acknowledged && next.pending_steering?.length === 0) throw new Error("queue ack persistence failed")
      return next
    }) }),
  })
  try {
    h.store.mutate(h.record.task_id, (record) => ({ ...record, pending_steering: pending }))
    assert.equal((await h.send()).kind, "delivery_uncertain")
    fault = false
    const marker = h.store.load(h.record.task_id)?.revive_delivery_uncertain
    assert.equal(marker?.run_epoch, 1)
    const terminal = h.manager.waitFor(h.record.task_id, { signal: AbortSignal.timeout(5000) })
    if (status === "interrupted") assert.equal((await h.manager.interruptTask(h.record.task_id)).kind, "interrupted")
    h.fake.settle(status === "error"
      ? { status: "error", failure: { kind: "session_unavailable", message: "FIXTURE_FAILURE" } }
      : { status: "completed", finalResponse: "ACCEPTED_BATCH" })
    await terminal
    assert.equal(h.store.load(h.record.task_id)?.status, status)
    assert.equal(h.store.load(h.record.task_id)?.residency_state, "resident")
    assert(h.manager.getResidentHandle(h.record.task_id))
    const next = await h.send("DISTINCT_NEXT_MESSAGE")
    assert.equal(next.kind, "delivery_uncertain")
    assert(next.kind === "delivery_uncertain")
    assert.equal(next.run_epoch, 1)
    assert(next.reason.length > 0 && next.suggestion.length > 0)
    assert.equal(h.store.load(h.record.task_id)?.notification.run_epoch, 1)
    assert.deepEqual(h.store.load(h.record.task_id)?.revive_delivery_uncertain, marker)
    assert.deepEqual(h.store.load(h.record.task_id)?.pending_steering, pending)
    assert.deepEqual(h.fake.followUpCalls, ["PENDING\n\nCONTINUE_SENTINEL"])
    assert.equal(h.resumed.length, 1)
    assert.equal((await h.manager.sendToTask({ idOrName: h.record.task_id, callerSessionId: "stranger", message: "DISTINCT_NEXT_MESSAGE" })).kind, "scope_denied")

    // Explicit resolution after inspecting the accepted output removes both the delivery marker
    // and the acknowledged batch. Merely asking for another run must never perform this edit.
    h.store.mutate(h.record.task_id, (record) => {
      const { revive_delivery_uncertain: _marker, pending_steering: _pending, ...resolved } = record
      return resolved
    })
    assert.deepEqual(await h.send("RESOLVED_NEXT_MESSAGE"), { kind: "revived", task_id: h.record.task_id, run_epoch: 2 })
    assert.deepEqual(h.fake.followUpCalls, ["PENDING\n\nCONTINUE_SENTINEL", "RESOLVED_NEXT_MESSAGE"])
    return { status, initial: "delivery_uncertain", next, resolvedEpoch: 2, acceptedBatchDeliveries: 1 }
  } finally { fault = false; await h.dispose() }
}

export async function generationAcrossContinuations(generation?: number) {
  let now = 1000
  const h = coldReviveHarness({ generation, now: () => now, idleTimeoutMs: 37 })
  try {
    assert.equal(h.store.load(h.record.task_id)?.config_generation, generation)
    assert.equal((await h.send()).kind, "revived")
    assert.equal(h.store.load(h.record.task_id)?.config_generation, generation)
    const first = h.manager.waitFor(h.record.task_id, { signal: AbortSignal.timeout(5000) })
    h.fake.settle({ status: "completed", finalResponse: "FIRST" })
    await first
    assert.equal(h.store.load(h.record.task_id)?.config_generation, generation)
    assert.equal((await h.send("WARM_CONTINUATION")).kind, "revived")
    assert.equal(h.resumed.length, 1)
    assert.equal(h.store.load(h.record.task_id)?.config_generation, generation)
    const second = h.manager.waitFor(h.record.task_id, { signal: AbortSignal.timeout(5000) })
    h.fake.settle({ status: "completed", finalResponse: "SECOND" })
    await second
    assert.equal(h.store.load(h.record.task_id)?.config_generation, generation)
    now += 37
    assert.deepEqual(await h.lifecycle.reclaimIdleResidents?.(), [h.record.task_id])
    assert.equal(h.store.load(h.record.task_id)?.residency_state, "persisted_only")
    assert.equal(h.store.load(h.record.task_id)?.config_generation, generation)
    assert.deepEqual(await h.send("COLD_AGAIN"), { kind: "revived", task_id: h.record.task_id, run_epoch: 3 })
    assert.equal(h.resumed.length, 2)
    assert.equal(h.store.load(h.record.task_id)?.config_generation, generation)
    assert.deepEqual(h.fake.followUpCalls, ["CONTINUE_SENTINEL", "WARM_CONTINUATION", "COLD_AGAIN"])
    return { generation: generation ?? "unknown", epochs: 3, coldResumes: h.resumed.length }
  } finally { await h.dispose() }
}
