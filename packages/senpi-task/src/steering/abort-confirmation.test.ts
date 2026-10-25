import { afterEach, describe, expect, test } from "bun:test"

import { cleanupSteering, makeFakeHandle, makeHarness } from "./__fixtures__/steering-fakes"
import { runTaskCancel } from "../tools/control/cancel"

afterEach(cleanupSteering)

for (const action of ["interruptTask", "cancelTask"] as const) {
  describe(`${action} abort receipt`, () => {
    for (const stopped of [true, false]) {
      test(`reports the host's stopped=${stopped} and cleared count only after its answer`, async () => {
        // given a running child whose host has not yet confirmed the abort
        const harness = makeHarness({ abortDeadline: () => new Promise(() => undefined) })
        const record = harness.seedRecord()
        harness.store.replace({ ...record, status: "running", residency_state: "resident" })
        const asked = Promise.withResolvers<undefined>()
        const answer = Promise.withResolvers<undefined>()
        const receipt = { effectId: "abort-effect", stopped, idle: stopped, cleared: 2 }
        const fake = makeFakeHandle(record.task_id, "rpc")
        harness.setLive(record.task_id, {
          ...fake.handle,
          abort: async () => { asked.resolve(undefined); await answer.promise; return receipt },
        })
        let settled = false

        // when the request is dispatched but its effect is still pending
        const work = harness.engine[action](record.task_id).then(result => { settled = true; return result })
        await asked.promise
        expect(settled).toBe(false)
        answer.resolve(undefined)

        // then the caller gets the actual receipt, including a negative stop confirmation
        expect(await work).toMatchObject({ abort: receipt })
      })
    }
  })
}

test("task_cancel preserves the engine's abort receipt in tool details", async () => {
  // given a host that cleared its queue but did not confirm a stopped turn
  const harness = makeHarness({ abortDeadline: () => new Promise(() => undefined) })
  const record = harness.seedRecord()
  harness.store.replace({ ...record, status: "running", residency_state: "resident" })
  const receipt = { effectId: "tool-abort-effect", stopped: false, idle: false, cleared: 1 }
  harness.setLive(record.task_id, {
    ...makeFakeHandle(record.task_id, "rpc").handle,
    abort: async () => receipt,
  })

  // when the actual tool consumes the steering result
  const result = await runTaskCancel({
    cancelTask: harness.engine.cancelTask,
    get: id => harness.store.load(id) ?? undefined,
  }, { task_id: record.task_id })

  // then its machine-readable details retain that negative confirmation
  expect(result.details).toMatchObject({ abort: receipt })
})
