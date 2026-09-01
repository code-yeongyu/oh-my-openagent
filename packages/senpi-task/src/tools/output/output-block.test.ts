import { describe, expect, test } from "bun:test"

import type { ListScope, ListedTask } from "../../manager"
import type { TaskRecord } from "../../state"
import { makeRecord } from "./__fixtures__/records"
import { runTaskOutput, TaskOutputParams } from "./output"
import type { OutputManager, TaskOutputDeps, TaskOutputToolResult } from "./types"

const BLOCKING_REMOVED_GUIDANCE = 'blocking removed - completion arrives as a notification; use mode:"tail" to peek.'

type ObservableOutputManager = OutputManager & {
  readonly waitFor: (taskId: string) => Promise<TaskRecord>
  readonly waitForCalls: () => readonly string[]
}

function managerFrom(records: readonly TaskRecord[]): ObservableOutputManager {
  const waitForCalls: string[] = []
  return {
    get: (taskId) => records.find((record) => record.task_id === taskId),
    list(scope: ListScope): readonly ListedTask[] {
      const filtered =
        scope.scope === "all" ? records : records.filter((record) => record.parent_session_id === scope.session_id)
      return filtered.map((record) => ({ record }))
    },
    waitFor: (taskId) => {
      waitForCalls.push(taskId)
      return Promise.resolve(records.find((record) => record.task_id === taskId) ?? makeRecord({ task_id: taskId }))
    },
    waitForCalls: () => waitForCalls,
  }
}

function depsFrom(manager: ObservableOutputManager): TaskOutputDeps {
  return {
    manager,
    stateDir: "/tmp/state",
    now: () => Date.parse("2024-12-03T15:00:00.000Z"),
    transcriptReader: () => ({ entries: [], source: "none" }),
  }
}

function firstText(result: TaskOutputToolResult): string {
  const first = result.content[0]
  return first?.type === "text" ? first.text : ""
}

describe("runTaskOutput non-blocking peek", () => {
  test("#given the task_output schema #when exposed to a model #then blocking controls are absent", () => {
    // when
    const properties = TaskOutputParams.properties

    // then
    expect(properties).not.toHaveProperty("block")
    expect(properties).not.toHaveProperty("timeout_ms")
    expect(properties).not.toHaveProperty("wait_for")
  })

  test("#given a running child #when task_output reads its status #then it returns its running snapshot without waiting", async () => {
    // given
    const running = makeRecord({ task_id: "st_running", status: "running" })
    const manager = managerFrom([running])

    // when
    const result = await runTaskOutput(depsFrom(manager), { task_id: running.task_id, mode: "status" }, "session-parent")

    // then
    expect(manager.waitForCalls()).toEqual([])
    expect(result.details.kind).toBe("status")
    if (result.details.kind === "status") expect(result.details.snapshot.status).toBe("running")
  })

  test.each([
    ["block true", { block: true }],
    ["block false", { block: false }],
    ["blocking timeout", { timeout_ms: 1 }],
  ] as const)("#given a legacy %s param #when task_output runs #then it redirects to notification-driven peeks", async (_label, legacyParam) => {
    // given
    const running = makeRecord({ task_id: "st_running", status: "running" })
    const manager = managerFrom([running])

    // when
    const result = await runTaskOutput(depsFrom(manager), { task_id: running.task_id, ...legacyParam }, "session-parent")

    // then
    expect(manager.waitForCalls()).toEqual([])
    expect(result.details.kind).toBe("invalid_arguments")
    expect(firstText(result)).toBe(BLOCKING_REMOVED_GUIDANCE)
  })
})
