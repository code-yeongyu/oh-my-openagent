import { afterEach, expect, test } from "bun:test"

import { cleanupProjects, fakeHandle, FakeRegistry, seedRecord, settings, tempStore } from "./__fixtures__/lifecycle-fakes"
import { createTaskLifecycle } from "./create"
import { NO_HOST_ENDPOINT } from "./host-session"

afterEach(cleanupProjects)

test("#given live children whose uncertain inputs hang on retry #when the parent session starts #then start reconciliation does not wait on them and every retry is issued", async () => {
  // given
  const store = tempStore()
  const registry = new FakeRegistry()
  const hung = Promise.withResolvers<void>()
  const issued: string[] = []
  for (const taskId of ["st_10129001", "st_10129002"]) {
    seedRecord(store, { task_id: taskId, parent_session_id: "parent-1", status: "pending", execution_mode: "process" })
    store.transition(taskId, { type: "start", timestamp: new Date().toISOString() })
    store.mutate(taskId, record => ({
      ...record,
      uncertain_inputs: [{ type: "steer", message: "once", clientMessageId: `${taskId}:0:1` }],
    }))
    registry.add({
      ...fakeHandle(taskId, "rpc", []),
      reconcileInputs: () => {
        issued.push(taskId)
        return hung.promise
      },
    })
  }
  const lifecycle = createTaskLifecycle({
    store, registry, config: settings({ reattach_on_reconcile: false }),
    hostPid: process.pid, hostEndpoint: NO_HOST_ENDPOINT,
    signaller: { isAlive: () => true, signal: () => {} },
  })

  // when
  const started = lifecycle.reconcileOnSessionStart("parent-1")

  // then
  const outcome = await Promise.race([
    started.then(() => "settled" as const),
    new Promise<"hung">(resolve => setTimeout(() => resolve("hung"), 5_000)),
  ])
  hung.resolve()
  expect(outcome).toBe("settled")
  expect(issued.sort()).toEqual(["st_10129001", "st_10129002"])
})
