import { afterEach, expect, test } from "bun:test"

import { cleanupSteering, makeHarness } from "./__fixtures__/steering-fakes"

afterEach(cleanupSteering)

test("#given a running process with a persisted pid but no local handle #when cancelled #then it remains resident and unmodified", async () => {
  // given
  const harness = makeHarness()
  const record = { ...harness.seedRecord({ execution_mode: "process" }), pid: 4321 }
  harness.store.replace(record)
  harness.store.transition(record.task_id, { type: "start", timestamp: new Date().toISOString() })

  // when
  const outcome = await harness.engine.cancelTask({ idOrName: record.task_id, callerSessionId: "parent-1" })

  // then
  expect(outcome).toEqual({
    kind: "unmanaged_live_process",
    task_id: record.task_id,
    pid: 4321,
    reason: `Task ${record.task_id} has no local handle for process pid 4321.`,
  })
  expect(harness.store.load(record.task_id)?.status).toBe("running")
  expect(harness.store.load(record.task_id)?.residency_state).toBe("resident")
  expect(harness.destruction.calls).toEqual([])
})

test("#given a running process with a persisted pid but no local handle #when interrupted #then it refuses without transition or signal", async () => {
  const harness = makeHarness()
  const record = { ...harness.seedRecord({ execution_mode: "process" }), pid: 4321 }
  harness.store.replace(record)
  harness.store.transition(record.task_id, { type: "start", timestamp: new Date().toISOString() })

  const outcome = await harness.engine.interruptTask({ idOrName: record.task_id, callerSessionId: "parent-1" })

  expect(outcome).toEqual({
    kind: "unmanaged_live_process",
    task_id: record.task_id,
    pid: 4321,
    reason: `Task ${record.task_id} has no local handle for process pid 4321.`,
  })
  expect(harness.store.load(record.task_id)?.status).toBe("running")
  expect(harness.store.load(record.task_id)?.residency_state).toBe("resident")
  expect(harness.destruction.calls).toEqual([])
})
