import { afterEach, describe, expect, test } from "bun:test"

import { baseSpec, cleanupProjects, makeManager } from "../../manager/__fixtures__/manager-fakes"
import { runTaskSend } from "./send"

afterEach(cleanupProjects)

const MISSING = "st_00000000"

function swapped<T>(value: T, input: string): T {
  return JSON.parse(JSON.stringify(value).replaceAll(MISSING, input)) as T
}

async function started(manager: ReturnType<typeof makeManager>["manager"], parent: string, name?: string) {
  const result = await manager.start(baseSpec({ parent_session_id: parent, ...(name === undefined ? {} : { name }) }))
  if (result.kind !== "started") throw new Error(`expected started, got ${result.kind}`)
  return result.task_id
}

async function twoSessions() {
  const harness = makeManager({})
  const own = await started(harness.manager, "sess-A", "alpha")
  const named = await started(harness.manager, "sess-B", "review")
  const live = await started(harness.manager, "sess-B")
  const done = await started(harness.manager, "sess-B")
  harness.store.transition(done, { type: "complete", timestamp: new Date().toISOString(), final_response: "done" })
  return { ...harness, own, named, live, done }
}

describe("task_send answers a task outside the caller's scope as not found", () => {
  test("#given another session's name, running task, finished task and a missing id #when sent or re-dispatched without all_scope #then every answer equals the missing-id answer and lists only the caller's tasks", async () => {
    const { manager, store, live, done } = await twoSessions()
    const inputs = ["review", live, done]
    const before = inputs.slice(1).map((taskId) => store.load(taskId))

    const missing = await runTaskSend(manager, { to: MISSING, message: "hi" }, "sess-A")
    const missingRedispatch = await runTaskSend(manager, { to: MISSING, redispatch: true }, "sess-A")

    expect(missing.details).toMatchObject({ kind: "not_found", known_tasks: ["alpha"] })
    expect(missingRedispatch.details).toMatchObject({ kind: "not_found", known_tasks: ["alpha"] })
    for (const input of inputs) {
      expect(await runTaskSend(manager, { to: input, message: "hi" }, "sess-A")).toEqual(swapped(missing, input))
      expect(await runTaskSend(manager, { to: input, redispatch: true }, "sess-A")).toEqual(
        swapped(missingRedispatch, input),
      )
    }
    expect(inputs.slice(1).map((taskId) => store.load(taskId))).toEqual(before)
  })

  test("#given all_scope #when one session sends to another session's task by name and re-dispatches it by id #then both act", async () => {
    const { manager, store, named, live } = await twoSessions()
    store.mutate(live, (record) => ({
      ...record,
      awaiting_input: { reason: "resumed_turn_aborted", since: new Date().toISOString() },
    }))

    const sent = await runTaskSend(manager, { to: "review", message: "hi", all_scope: true }, "sess-A")
    const redispatched = await runTaskSend(manager, { to: live, redispatch: true, all_scope: true }, "sess-A")

    expect(sent.details).toMatchObject({ kind: "steered", task_id: named })
    expect(redispatched.details).toMatchObject({ kind: "redispatched", task_id: live })
  })

  test("#given no caller session #when sent without all_scope #then nothing resolves, and with all_scope the task is reached", async () => {
    const { manager, own } = await twoSessions()

    const missing = await runTaskSend(manager, { to: MISSING, message: "hi" }, undefined)
    const unscoped = await runTaskSend(manager, { to: own, message: "hi" }, undefined)
    const crossed = await runTaskSend(manager, { to: own, message: "hi", all_scope: true }, undefined)

    expect(missing.details).toMatchObject({ kind: "not_found", known_tasks: [] })
    expect(unscoped).toEqual(swapped(missing, own))
    expect(crossed.details).toMatchObject({ kind: "steered", task_id: own })
  })
})
