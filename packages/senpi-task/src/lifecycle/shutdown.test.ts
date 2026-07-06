import { afterEach, describe, expect, test } from "bun:test"

import { createTaskLifecycle } from "./create"
import {
  cleanupProjects,
  fakeHandle,
  FakeRegistry,
  seedRecord,
  settings,
  tempStore,
  type CallLog,
} from "./__fixtures__/lifecycle-fakes"

afterEach(cleanupProjects)

describe("teardownOnSessionShutdown", () => {
  test("#given mixed resident children #when tearing down #then in-process aborts before dispose and rpc terminates before detach", async () => {
    // given
    const store = tempStore()
    seedRecord(store, { task_id: "st_000000f0", status: "running", residency_state: "resident", execution_mode: "in-process" })
    seedRecord(store, { task_id: "st_000000f1", status: "running", residency_state: "resident", execution_mode: "process" })
    const registry = new FakeRegistry()
    const order: CallLog = []
    registry.add(fakeHandle("st_000000f0", "in-process", order))
    registry.add(fakeHandle("st_000000f1", "rpc", order, { pid: 55 }))
    const lifecycle = createTaskLifecycle({ store, registry, config: settings() })

    // when
    const summary = await lifecycle.teardownOnSessionShutdown()

    // then abort precedes dispose for the in-process child (TERM->KILL ordering proven in terminate.test.ts)
    expect(order.indexOf("abort:st_000000f0")).toBeLessThan(order.indexOf("dispose:st_000000f0"))
    expect(order.indexOf("terminate:st_000000f1")).toBeLessThan(order.indexOf("dispose:st_000000f1"))
    expect(summary).toEqual({ in_process: 1, rpc: 1, total: 2 })
    expect(registry.forgotten.toSorted()).toEqual(["st_000000f0", "st_000000f1"])
  })

  test("#given no resident children #when tearing down #then it reports an empty summary without throwing", async () => {
    // given
    const store = tempStore()
    const lifecycle = createTaskLifecycle({ store, registry: new FakeRegistry(), config: settings() })

    // when
    const summary = await lifecycle.teardownOnSessionShutdown()

    // then
    expect(summary).toEqual({ in_process: 0, rpc: 0, total: 0 })
  })
})
