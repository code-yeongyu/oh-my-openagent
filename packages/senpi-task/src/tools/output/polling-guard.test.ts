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

  test("#given an unchanged status timestamp #when only the child pid changes #then the next status peek returns a fresh snapshot", async () => {
    const initial = makeRecord({ task_id: "st_pid", name: "worker", pid: 111 })
    let record: TaskRecord = initial
    const manager: OutputManager = {
      get: () => record,
      list: () => [{ record }],
    }
    const output = createTaskOutputTool({
      manager,
      stateDir: "/tmp/state",
      transcriptReader: () => ({ entries: [], source: "none" }),
    })
    const execute = () =>
      output.execute("call", { task_id: record.task_id }, undefined, undefined, context("session-a"))

    const first = await execute()
    record = { ...record, pid: 222 }
    const afterPid = await execute()
    const unchanged = await execute()

    expect(first.details.kind).toBe("status")
    expect(afterPid.details.kind).toBe("status")
    if (afterPid.details.kind === "status") expect(afterPid.details.snapshot.pid).toBe(222)
    expect(unchanged.details).toMatchObject({ kind: "no_progress", task_id: record.task_id })
  })

  test("#given more callers than the status cache limit #when the oldest caller reads again #then its stale fingerprint was evicted", async () => {
    // given
    const record = makeRecord({ task_id: "st_shared", name: "worker" })
    const manager: OutputManager = {
      get: () => record,
      list: () => [{ record }],
    }
    const output = createTaskOutputTool({
      manager,
      stateDir: "/tmp/state",
      transcriptReader: () => ({ entries: [], source: "none" }),
    })
    const execute = (sessionId: string) =>
      output.execute("call", { task_id: record.task_id }, undefined, undefined, context(sessionId))

    // when
    const first = await execute("session-0")
    for (let index = 1; index <= 1024; index += 1) await execute(`session-${index}`)
    const afterEviction = await execute("session-0")

    // then
    expect(first.details.kind).toBe("status")
    expect(afterEviction.details.kind).toBe("status")
  })
})
