import { afterEach, expect, test } from "bun:test"
import { cleanupProjects, makeManager } from "../manager/__fixtures__/manager-fakes"
import { cleanupSteering, makeHarness } from "../steering/__fixtures__/steering-fakes"
import { createEvalHandleHost } from "./host"

afterEach(() => {
  cleanupProjects()
  cleanupSteering()
})

test("#given a queued send #when cancellation ends the run before the reply #then the eval handle never reports host delivery", async () => {
  const h = makeHarness()
  const record = h.seedRecord()
  const { manager } = makeManager({ store: h.store })
  const host = createEvalHandleHost({
    tasks: {
      get: id => manager.get(id),
      waitFor: (id, options) => manager.waitFor(id, options),
      cancelTask: (id, reason, options) => manager.cancelTask(id, reason, options),
      sendToTask: async input => {
        const outcome = await manager.sendToTask(input)
        expect(outcome.kind).toBe("queued")
        await manager.cancelTask(input.idOrName, "cancel before host receipt")
        return outcome
      },
    },
    workpools: manager.workpools,
    poolCaller: sessionId => ({ sessionId, rootSessionId: sessionId, depth: 0, cwd: "/" }),
    stateDir: h.store.stateDir,
  })

  const reply = await host.send(
    { kind: "agent", id: record.task_id, run_epoch: 0 },
    "queued context",
    { ownerSessionId: record.parent_session_id },
  )

  expect(reply.phase).toBe("cancelled")
  expect(reply.host_status).toBe("queued")
})
