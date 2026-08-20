import { describe, expect, test } from "bun:test"

import type { ListScope, ListedTask } from "../../manager"
import type { TaskRecord } from "../../state"
import { makeRecord } from "./__fixtures__/records"
import { createTaskOutputTool, type TaskOutputInput } from "./output"
import type { OutputManager } from "./types"

function context(sessionId: string) {
  return { sessionManager: { getSessionId: () => sessionId } } as never
}

describe("task_output polling guard", () => {
  test("#given one status peek #when the same caller reads the unchanged task again #then the full snapshot is not replayed", async () => {
    // given
    const parentA = makeRecord({ task_id: "st_parent_a", name: "worker", parent_session_id: "session-a" })
    const parentB = makeRecord({ task_id: "st_parent_b", name: "worker", parent_session_id: "session-b" })
    let records: readonly TaskRecord[] = [parentA, parentB]
    const manager: OutputManager = {
      get: (taskId) => records.find((record) => record.task_id === taskId),
      list(scope: ListScope): readonly ListedTask[] {
        const filtered =
          scope.scope === "all" ? records : records.filter((record) => record.parent_session_id === scope.session_id)
        return filtered.map((record) => ({ record }))
      },
    }
    const output = createTaskOutputTool({
      manager,
      stateDir: "/tmp/state",
      transcriptReader: () => ({ entries: [], source: "none" }),
    })
    const execute = (params: TaskOutputInput, sessionId: string) =>
      output.execute("call", params, undefined, undefined, context(sessionId))

    // when
    const first = await execute({ name: "worker" }, "session-a")
    const unchanged = await execute({ task_id: parentA.task_id }, "session-a")
    const diagnostic = await execute({ name: "worker", mode: "tail" }, "session-b")
    const otherCaller = await execute({ name: "worker" }, "session-b")
    records = [
      {
        ...parentA,
        status: "completed",
        updated_at: "2024-12-03T14:01:00.000Z",
        final_response: "done",
      },
      parentB,
    ]
    const progressed = await execute({ task_id: parentA.task_id }, "session-a")

    // then
    expect(first.details.kind).toBe("status")
    expect(unchanged.details).toMatchObject({
      kind: "no_progress",
      task_id: parentA.task_id,
      status: "running",
    })
    expect("snapshot" in unchanged.details).toBe(false)
    expect(diagnostic.details.kind).toBe("transcript")
    expect(otherCaller.details.kind).toBe("status")
    expect(progressed.details.kind).toBe("status")
    if (progressed.details.kind === "status") expect(progressed.details.snapshot.final_response).toBe("done")
  })
})
