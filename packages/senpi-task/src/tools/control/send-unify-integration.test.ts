import { afterEach, describe, expect, test } from "bun:test"

import { baseSpec, cleanupProjects, makeManager } from "../../manager/__fixtures__/manager-fakes"
import { runTaskSend } from "./send"

afterEach(cleanupProjects)

describe("task_send unified park and revive integration", () => {
  test("#given a running child #when task_send parks then follows up #then the revived turn completes", async () => {
    const { manager, inProcess } = makeManager({})
    const started = await manager.start(baseSpec({ parent_session_id: "p1", name: "alpha" }))
    if (started.kind !== "started") throw new Error("expected started")
    const fake = inProcess.handles.get(started.task_id)
    if (fake === undefined) throw new Error("expected fake handle")

    const parked = await runTaskSend(manager, { to: started.task_id, deliver_as: "interrupt" }, "p1")

    expect(parked.details).toEqual({ kind: "interrupted", task_id: started.task_id, previous_status: "running" })
    const interrupted = manager.get(started.task_id)
    expect(interrupted?.status).toBe("interrupted")
    expect(interrupted?.residency_state).toBe("resident")

    const abortedTurnSettled = fake.handle.waitForOutcome()
    fake.settle({ status: "cancelled" })
    await abortedTurnSettled

    const stableAfterAbort = manager.get(started.task_id)
    expect(stableAfterAbort?.status).toBe("interrupted")
    expect(stableAfterAbort?.residency_state).toBe("resident")

    const revived = await runTaskSend(manager, { to: started.task_id, message: "finish with new answer" }, "p1")

    expect(revived.details.kind).toBe("revived")
    const revivedTurnSettled = fake.handle.waitForOutcome()
    fake.settle({ status: "completed", finalResponse: "revived final response" })
    await revivedTurnSettled
    const completed = await manager.waitFor(started.task_id)
    expect(completed.status).toBe("completed")
    expect(completed.final_response).toBe("revived final response")
  })
})
