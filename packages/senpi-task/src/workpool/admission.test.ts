import { expect, test } from "bun:test"
import { TaskConcurrency } from "../manager/concurrency"
import { createWorkpoolStore } from "./store"
import { bounded, deferred, evidence, fixture, poolInput } from "./__fixtures__/admission"
import { runAdversarialCases } from "./__fixtures__/adversarial"
import type { SpawnAdmission } from "../manager/types"
import { failureEvidence, runCapacityCases, runModeCases, runReloadCases } from "./__fixtures__/cases"

const signal = () => AbortSignal.timeout(5000)

test("#given exhausted lanes #when push returns before grant #then IDs are durable and exactly one dispatch follows grant", async () => {
  // given
  const f = fixture()
  f.concurrency.tryAcquire("test/model", "st_00000001", 0)
  const pool = f.manager.workpools.create(f.caller, poolInput)
  const waiting = f.manager.workpools.waitForEvent(pool.pool_id, "waiting", signal())
  const dispatched = f.manager.workpools.waitForEvent(pool.pool_id, "dispatched", signal())
  // when
  const receipt = f.manager.workpools.push(f.caller, pool.pool_id, [{ key: "a", input: { n: 1 } }])
  // then
  expect(receipt.item_ids).toHaveLength(1)
  expect(f.starts).toEqual([])
  expect(f.store.list().records).toEqual([])
  const persisted = createWorkpoolStore(f.store.stateDir).load(pool.pool_id)
  expect(persisted.items[0]?.item_id).toBe(receipt.item_ids[0]?.item_id)
  await waiting
  expect(f.starts).toEqual([])
  f.concurrency.releaseLease("st_00000001", 0)
  const event = await dispatched
  expect(f.starts).toHaveLength(1)
  expect(f.concurrency.getRetainedKeyCounts().leases).toBe(1)
  expect(f.events.filter(value => value.kind === "granted")).toHaveLength(1)
  const idle = f.manager.workpools.waitForEvent(pool.pool_id, "worker_idle", signal())
  if (event.task_id === undefined) throw new Error("missing dispatched identity")
  f.handles.get(event.task_id)?.settle({ status: "completed", finalResponse: "DONE" })
  await idle
  expect(f.concurrency.getRetainedKeyCounts().leases).toBe(0)
  evidence("happy", { receipt, persisted, events: f.events, starts: f.starts.map(spec => spec.taskId), leases: f.concurrency.getRetainedKeyCounts() })
})

test("#given zero capacity and acquisition races #when a queued pool is cancelled #then no late grant can spawn", async () => {
  // given
  const f = fixture()
  f.concurrency.tryAcquire("test/model", "st_00000001", 0)
  const pool = f.manager.workpools.create(f.caller, poolInput)
  const waiting = f.manager.workpools.waitForEvent(pool.pool_id, "waiting", signal())
  f.manager.workpools.push(f.caller, pool.pool_id, [{ key: "a", input: null }])
  await waiting
  // when
  const cancelled = f.manager.workpools.cancel(f.caller, pool.pool_id)
  f.concurrency.releaseLease("st_00000001", 0)
  // then
  expect(f.starts).toEqual([])
  expect(cancelled.items[0]?.status).toBe("cancelled")
  expect(f.manager.workpools.cancel(f.caller, pool.pool_id).generation).toBe(cancelled.generation)
  expect(f.concurrency.getRetainedKeyCounts()).toEqual({ lanes: 0, queues: 0, leases: 0 })
  failureEvidence("cancelled-queued", { cancelled, events: f.events })
})

test("#given zero capacity and acquisition races #when advisory capacity loses atomically #then the waiter remains exactly once", async () => {
  // given
  class RacingConcurrency extends TaskConcurrency {
    armed = true
    override tryAcquire(model: string, taskId: string, epoch: number): boolean {
      if (this.armed) { this.armed = false; expect(super.tryAcquire("racer/model", "st_00000002", 0)).toBe(true); return false }
      return super.tryAcquire(model, taskId, epoch)
    }
  }
  const f = fixture({ concurrency: new RacingConcurrency({ global_concurrency: 1 }) })
  expect(f.concurrency.hasFreeSlot("test/model")).toBe(true)
  const pool = f.manager.workpools.create(f.caller, poolInput)
  const waiting = f.manager.workpools.waitForEvent(pool.pool_id, "waiting", signal())
  const dispatched = f.manager.workpools.waitForEvent(pool.pool_id, "dispatched", signal())
  // when
  f.manager.workpools.push(f.caller, pool.pool_id, [{ key: "a", input: null }])
  await waiting
  // then
  expect(f.starts).toEqual([])
  expect(f.concurrency.getRetainedKeyCounts()).toEqual({ lanes: 1, queues: 1, leases: 1 })
  f.concurrency.releaseLease("st_00000002", 0)
  await dispatched
  expect(f.starts).toHaveLength(1)
  expect(f.events.filter(event => event.kind === "waiting")).toHaveLength(1)
  expect(f.concurrency.getRetainedKeyCounts().queues).toBe(0)
  failureEvidence("atomic-acquisition-race", f.events)
})

test("#given zero capacity and acquisition races #when cancellation wins during residency admission #then the granted lease is released without spawn", async () => {
  // given
  const gate = deferred<SpawnAdmission>()
  const released = deferred<void>()
  class ObservedConcurrency extends TaskConcurrency {
    override releaseLease(taskId: string, epoch: number): void { super.releaseLease(taskId, epoch); released.resolve() }
  }
  const f = fixture({ concurrency: new ObservedConcurrency({ global_concurrency: 1 }), admit: () => gate.promise })
  const pool = f.manager.workpools.create(f.caller, poolInput)
  const granted = f.manager.workpools.waitForEvent(pool.pool_id, "granted", signal())
  f.manager.workpools.push(f.caller, pool.pool_id, [{ key: "a", input: 1 }])
  await granted
  // when
  const releaseObserved = bounded(released.promise)
  f.manager.workpools.cancel(f.caller, pool.pool_id)
  gate.resolve({ kind: "admitted" })
  await releaseObserved
  // then
  expect(f.starts).toEqual([])
  expect(f.store.list().records).toEqual([])
  expect(f.concurrency.getRetainedKeyCounts().leases).toBe(0)
  failureEvidence("cancel-during-residency", f.events)
})

runCapacityCases()
runModeCases()
runReloadCases()
runAdversarialCases()
