import { describe, expect, test } from "bun:test"

import type { ContinueResult } from "../../manager"
import type { TaskRecord } from "../../state"
import { CTX, createFakeManager, makeDeps, makeRecord } from "./__fixtures__/task-tool-fakes"
import { buildTaskExecute } from "./execute"

describe("buildTaskExecute continuation", () => {
  test("#given task_id #when continued synchronously #then continueTask is called with exact args and final response returns", async () => {
    // given
    let continueArgs: { id: string; prompt: string; deliverAs?: string } | undefined
    const manager = createFakeManager({
      continueTask: async (id, prompt, deliverAs): Promise<ContinueResult> => {
        continueArgs = { id, prompt, ...(deliverAs !== undefined && { deliverAs }) }
        return { kind: "continued", task_id: id, status: "running", delivered: "followUp" }
      },
      waitFor: async (): Promise<TaskRecord> =>
        makeRecord({ task_id: "st_0000000c", status: "completed", final_response: "RESUMED OUTPUT" }),
    })
    const execute = buildTaskExecute(makeDeps(manager))

    // when
    const result = await execute("c", { prompt: "keep going", task_id: "st_0000000c" }, undefined, undefined, CTX)

    // then
    expect(continueArgs).toEqual({ id: "st_0000000c", prompt: "keep going", deliverAs: "followUp" })
    const text = result.content[0]?.type === "text" ? result.content[0].text : ""
    expect(text).toContain("RESUMED OUTPUT")
    expect(result.details.mode).toBe("continuation")
  })

  test("#given task_id and run_in_background #when continued #then it returns immediately without awaiting", async () => {
    // given
    let waitForCalls = 0
    const manager = createFakeManager({
      continueTask: async (id): Promise<ContinueResult> => ({
        kind: "continued",
        task_id: id,
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
      continueTask: async (): Promise<ContinueResult> => ({
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
})
