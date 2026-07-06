import { afterEach, describe, expect, test } from "bun:test"

import type { SendInput, SendOutcome } from "../../steering"
import { baseSpec, cleanupProjects, makeManager } from "../../manager/__fixtures__/manager-fakes"
import { runTaskSend } from "./send"
import type { SendManager } from "./types"

afterEach(cleanupProjects)

function spyManager(outcome: SendOutcome): { manager: SendManager; calls: SendInput[] } {
  const calls: SendInput[] = []
  const manager: SendManager = {
    sendToTask: (input) => {
      calls.push(input)
      return Promise.resolve(outcome)
    },
    list: () => [],
  }
  return { manager, calls }
}

describe("runTaskSend", () => {
  test("#given a running child #when a message is sent #then it is delivered as followUp by default", async () => {
    // given
    const { manager } = makeManager({})
    const started = await manager.start(baseSpec({ parent_session_id: "p1" }))
    if (started.kind !== "started") throw new Error("expected started")

    // when
    const result = await runTaskSend(manager, { task_id: started.task_id, message: "keep going" }, "p1")

    // then
    expect(result.details.kind).toBe("steered")
    if (result.details.kind !== "steered") throw new Error("expected steered")
    expect(result.details.delivered).toBe("followUp")
    expect(result.details.task_id).toBe(started.task_id)
  })

  test("#given a caller session id #when sending #then callerSessionId is injected into the steering call", async () => {
    // given
    const { manager, calls } = spyManager({ kind: "steered", task_id: "st_00000001", status: "running", delivered: "followUp" })

    // when
    await runTaskSend(manager, { task_id: "st_00000001", message: "hi" }, "session-42")

    // then
    expect(calls[0]?.callerSessionId).toBe("session-42")
    expect(calls[0]?.allScope).toBeUndefined()
  })

  test("#given all_scope true #when sending #then allScope is forwarded to the engine", async () => {
    // given
    const { manager, calls } = spyManager({ kind: "steered", task_id: "st_00000001", status: "running", delivered: "steer" })

    // when
    await runTaskSend(manager, { task_id: "st_00000001", message: "hi", deliver_as: "steer", all_scope: true }, "session-42")

    // then
    expect(calls[0]?.allScope).toBe(true)
    expect(calls[0]?.deliverAs).toBe("steer")
  })

  test("#given a child owned by another session #when sent without all_scope #then scope is denied naming the owner", async () => {
    // given
    const { manager } = makeManager({})
    const started = await manager.start(baseSpec({ parent_session_id: "owner-session" }))
    if (started.kind !== "started") throw new Error("expected started")

    // when
    const result = await runTaskSend(manager, { task_id: started.task_id, message: "hi" }, "intruder-session")

    // then
    expect(result.details.kind).toBe("scope_denied")
    if (result.details.kind !== "scope_denied") throw new Error("expected scope_denied")
    expect(result.details.owning_session_id).toBe("owner-session")
    expect(result.content[0]?.type === "text" && result.content[0].text).toContain("owner-session")
  })

  test("#given an unknown name #when sending #then not_found lists this session's task names", async () => {
    // given
    const { manager } = makeManager({})
    const started = await manager.start(baseSpec({ parent_session_id: "p1", name: "alpha" }))
    if (started.kind !== "started") throw new Error("expected started")

    // when
    const result = await runTaskSend(manager, { name: "ghost", message: "hi" }, "p1")

    // then
    expect(result.details.kind).toBe("not_found")
    if (result.details.kind !== "not_found") throw new Error("expected not_found")
    expect(result.details.known_tasks).toContain("alpha")
    expect(result.content[0]?.type === "text" && result.content[0].text).toContain("alpha")
  })

  test("#given neither task_id nor name #when sending #then a typed invalid_arguments error is returned", async () => {
    // given
    const { manager } = spyManager({ kind: "not_found", reason: "unused", suggestion: "unused" })

    // when
    const result = await runTaskSend(manager, { message: "hi" }, "p1")

    // then
    expect(result.details.kind).toBe("invalid_arguments")
  })
})
