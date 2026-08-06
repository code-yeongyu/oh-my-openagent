import { describe, expect, it } from "bun:test"

import type { TaskRecord, TaskStatus } from "@oh-my-opencode/senpi-task"

import type { CapturedUi } from "./runtime-context"
import { createTaskStatusUi, type StatusUiManager, type StatusUiTimers } from "./status-ui"

function record(overrides: Partial<TaskRecord> & { task_id: string; status: TaskStatus }): TaskRecord {
  return {
    parent_session_id: "session-a",
    root_session_id: "session-a",
    depth: 0,
    execution_mode: "in-process",
    model: "anthropic/claude-sonnet-4-6",
    residency_state: "resident",
    created_at: "2026-07-07T00:00:00.000Z",
    updated_at: "2026-07-07T00:00:01.000Z",
    notify_on_terminal: false,
    notification: { run_epoch: 0, notified_epoch: -1 },
    ...overrides,
  }
}

describe("createTaskStatusUi spend", () => {
  it("#given live solo and process-member rows with cost facts #when rendered #then cost sits before tps without cache rate", () => {
    // given
    const timers: StatusUiTimers = {
      set: () => 1,
      clear: () => undefined,
    }
    const solo = record({ task_id: "st_solo", name: "Solo", status: "running", category: "quick" })
    const member = record({
      task_id: "st_member",
      name: "Member",
      status: "running",
      category: "quick",
      execution_mode: "process",
      pid: 4242,
    })
    const widgetCalls: Array<string[] | undefined> = []
    const ui: CapturedUi = {
      notify: () => undefined,
      setStatus: () => undefined,
      setWidget: (_key, content) => widgetCalls.push(content),
      select: () => Promise.resolve(undefined),
      confirm: () => Promise.resolve(false),
    }
    const manager: StatusUiManager = {
      list: () => [solo, member].map((task) => ({ record: task })),
      wasBackground: () => true,
      subscribeChild: () => () => undefined,
      runStatsSnapshot: (taskId) =>
        taskId === "st_solo"
          ? {
              runtime_ms: 1_000,
              turns: 2,
              tool_calls: 1,
              tokens_per_second: 40,
              cost_usd: 0.4213,
              cache_hit_rate_last: 0.8712,
              cache_hit_rate_run: 0.4,
            }
          : {
              runtime_ms: 1_000,
              turns: 1,
              tool_calls: 0,
              tokens_per_second: 12,
              cost_usd: 0.017,
              cache_hit_rate_last: 0.5,
              cache_hit_rate_run: 0.1,
            },
    }
    const statusUi = createTaskStatusUi({
      manager,
      runtime: { ui: () => ui, sessionId: () => "session-a", mode: () => "tui" },
      timers,
      now: () => Date.parse("2026-07-07T00:00:01.000Z"),
    })

    // when
    statusUi.syncNow()

    // then
    const rows = widgetCalls.at(-1) ?? []
    expect(rows[0]).toContain("$0.4213 · 40 tok/s")
    expect(rows[1]).toContain("$0.0170 · 12 tok/s")
    expect(rows.join("\n")).not.toContain("CH:")
  })
})
