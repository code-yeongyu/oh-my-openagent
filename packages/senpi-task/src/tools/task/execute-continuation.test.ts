import { describe, expect, test } from "bun:test"

import type { SendInput, SendOutcome } from "../../steering"
import type { TaskRecord } from "../../state"
import { CTX, createFakeManager, makeDeps, makeRecord } from "./__fixtures__/task-tool-fakes"
import { buildTaskExecute } from "./execute"

describe("buildTaskExecute continuation", () => {
  test("#given task_id #when continued synchronously #then sendToTask carries the caller session id and final response returns", async () => {
    // given
    let sendArgs: SendInput | undefined
    const manager = createFakeManager({
      sendToTask: async (input): Promise<SendOutcome> => {
        sendArgs = input
        return { kind: "steered", task_id: input.idOrName, status: "running", delivered: "followUp" }
      },
      waitFor: async (): Promise<TaskRecord> =>
        makeRecord({ task_id: "st_0000000c", status: "completed", final_response: "RESUMED OUTPUT" }),
    })
    const execute = buildTaskExecute(makeDeps(manager))

    // when
    const result = await execute("c", { prompt: "keep going", task_id: "st_0000000c" }, undefined, undefined, CTX)

    // then the scope-aware send route is driven with the caller (parent) session id
    expect(sendArgs).toEqual({
      idOrName: "st_0000000c",
      message: "keep going",
      deliverAs: "followUp",
      callerSessionId: "parent-session-1",
    })
    const text = result.content[0]?.type === "text" ? result.content[0].text : ""
    expect(text).toContain("RESUMED OUTPUT")
    expect(result.details.mode).toBe("continuation")
  })

  test("#given task_id and run_in_background #when continued #then it returns immediately without awaiting", async () => {
    // given
    let waitForCalls = 0
    const manager = createFakeManager({
      sendToTask: async (input): Promise<SendOutcome> => ({
        kind: "steered",
        task_id: input.idOrName,
        status: "running",
        delivered: "steer",
      }),
      waitFor: () => {
        waitForCalls += 1
        return new Promise<TaskRecord>(() => {})
      },
    })
    const execute = buildTaskExecute(makeDeps(manager))

    // when
    const result = await execute(
      "c",
      { prompt: "async follow", task_id: "st_0000000d", run_in_background: true },
      undefined,
      undefined,
      CTX,
    )

    // then
    expect(waitForCalls).toBe(0)
    expect(result.details.task_id).toBe("st_0000000d")
    expect(result.details.mode).toBe("continuation")
  })

  test("#given a not-continuable task #when continued #then it returns an error result with the suggestion", async () => {
    // given
    const manager = createFakeManager({
      sendToTask: async (): Promise<SendOutcome> => ({
        kind: "not_continuable",
        task_id: "st_0000000e",
        reason: "task is disposed",
        suggestion: "spawn a fresh task",
      }),
    })
    const execute = buildTaskExecute(makeDeps(manager))

    // when
    const result = await execute("c", { prompt: "x", task_id: "st_0000000e" }, undefined, undefined, CTX)

    // then
    expect(result.details.status).toBe("not_continuable")
    const text = result.content[0]?.type === "text" ? result.content[0].text : ""
    expect(text).toContain("spawn a fresh task")
  })

  test("#given a foreign session #when the send is scope_denied #then the tool surfaces scope_denied and never awaits", async () => {
    // given the engine refuses a cross-session send
    let waitForCalls = 0
    const manager = createFakeManager({
      sendToTask: async (input): Promise<SendOutcome> => ({
        kind: "scope_denied",
        task_id: input.idOrName,
        owning_session_id: "session-A",
        reason: `Task ${input.idOrName} belongs to session session-A; pass all_scope to send across sessions.`,
      }),
      waitFor: () => {
        waitForCalls += 1
        return new Promise<TaskRecord>(() => {})
      },
    })
    const execute = buildTaskExecute(makeDeps(manager))

    // when
    const result = await execute("c", { prompt: "leak", task_id: "st_0000000f" }, undefined, undefined, CTX)

    // then the refusal is reported and no completion is awaited
    expect(result.details.status).toBe("scope_denied")
    expect(waitForCalls).toBe(0)
    const text = result.content[0]?.type === "text" ? result.content[0].text : ""
    expect(text).toContain("all_scope")
  })
})
