import { describe, expect, test } from "bun:test"

import type { ManagerStartSpec, StartResult } from "../../manager"
import { CTX, createFakeManager, makeDeps } from "./__fixtures__/task-tool-fakes"
import { buildTaskExecute } from "./execute"

describe("buildTaskExecute spawn-only", () => {
  test("#given the task tool #when executed #then it always starts a new child task", async () => {
    // given
    let captured: ManagerStartSpec | undefined
    let sendToTaskCalls = 0
    const manager = createFakeManager({
      start: async (spec): Promise<StartResult> => {
        captured = spec
        return { kind: "started", task_id: "st_0000000c", status: "running", name: "spawned" }
      },
      sendToTask: async () => {
        sendToTaskCalls += 1
        return { kind: "not_found", reason: "not found", suggestion: "use task_send" }
      },
    })
    const execute = buildTaskExecute(makeDeps(manager))

    // when
    const result = await execute("c", { prompt: "new work", category: "quick", run_in_background: true }, undefined, undefined, CTX)

    // then
    expect(sendToTaskCalls).toBe(0)
    expect(captured?.prompt).toBe("new work")
    expect(result.details.mode).toBe("spawn")
  })
})
