import { afterEach, describe, expect, test } from "bun:test"

import { baseSpec, cleanupProjects, makeManager } from "../../manager/__fixtures__/manager-fakes"
import { runTaskOutput } from "../output/output"
import { runTaskCancel } from "./cancel"
import { runTaskSend } from "./send"

afterEach(cleanupProjects)

describe("task_send unified resident revive integration", () => {
  test("#given a numbered worker #when the parent peeks, steers, and cancels using aliases #then the same child is targeted and the canonical ID is preserved", async () => {
    const { manager, store, project } = makeManager({})
    const started = await manager.start(baseSpec({ parent_session_id: "p1", name: "alpha" }))
    if (started.kind !== "started") throw new Error("expected started")
    store.mutate(started.task_id, (record) => ({ ...record, nickname: "Io III" }))
    for (const [name, mode] of [["Io III", "status"], ["Io #3", "tail"], ["Io the Third", "full"]] as const) {
      const peek = await runTaskOutput({ manager, stateDir: project }, { name, mode }, "p1")
      expect(peek.details).toMatchObject({ snapshot: { task_id: started.task_id, nickname: "Io III" } })
      expect(peek.content[0]).toMatchObject({ text: expect.stringContaining(`Io III (${started.task_id})`) })
    }
    const foreign = await runTaskSend(manager, { to: "Io #3", message: "wrong parent", all_scope: true }, "p2")
    expect(foreign.details.kind).toBe("not_found")
    const sent = await runTaskSend(manager, { to: "Io the 3rd", message: "steer alias" }, "p1")
    expect(sent.details).toMatchObject({ kind: "steered", task_id: started.task_id, nickname: "Io III" })
    expect(sent.content[0]).toMatchObject({ text: expect.stringContaining(`Io III (${started.task_id})`) })
    const cancelled = await runTaskCancel(manager, { name: "Io #3" }, "p1")
    expect(cancelled.details).toMatchObject({ kind: "cancelled", task_id: started.task_id, nickname: "Io III" })
  })

  test("#given a completed resident child #when task_send sends another message #then the revived turn completes", async () => {
    const { manager, inProcess } = makeManager({})
    const started = await manager.start(baseSpec({ parent_session_id: "p1", name: "alpha" }))
    if (started.kind !== "started") throw new Error("expected started")
    const fake = inProcess.handles.get(started.task_id)
    if (fake === undefined) throw new Error("expected fake handle")

    const firstTurnSettled = fake.handle.waitForOutcome()
    fake.settle({ status: "completed", finalResponse: "first response" })
    await firstTurnSettled

    const completedResident = manager.get(started.task_id)
    expect(completedResident?.status).toBe("completed")
    expect(completedResident?.residency_state).toBe("resident")

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
