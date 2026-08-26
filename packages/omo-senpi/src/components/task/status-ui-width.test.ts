import { describe, expect, it } from "bun:test"

import {
  rendererVisibleWidth,
  type ListedTask,
  type TaskRecord,
  type TaskRunStats,
} from "@oh-my-opencode/senpi-task"

import type { CapturedUi } from "./runtime-context"
import { createTaskStatusUi, type StatusUiManager } from "./status-ui"

const task: TaskRecord = {
  task_id: "st_narrow",
  task_summary: "Plan the complete Spider-Man media library migration",
  parent_session_id: "session-a",
  root_session_id: "session-a",
  depth: 0,
  execution_mode: "in-process",
  model: "anthropic/claude-opus-5",
  status: "running",
  category: "unspecified-high",
  resolved_model: {
    provider: "anthropic",
    model_id: "claude-opus-5",
    display: "anthropic/claude-opus-5",
    reasoning_effort: "xhigh",
    source: "category",
  },
  residency_state: "resident",
  created_at: "2026-07-07T00:00:00.000Z",
  updated_at: "2026-07-07T00:01:00.000Z",
  notification: { run_epoch: 0, notified_epoch: -1 },
  notify_on_terminal: false,
}

const stats: TaskRunStats = {
  turns: 2,
  tool_calls: 4,
  runtime_ms: 60_000,
  cost_usd: 0.1303,
  cache_hit_rate_last: 0.89,
  tokens_per_second: 97,
}

function fakeUi(): CapturedUi & { readonly rows: string[][] } {
  const rows: string[][] = []
  return {
    rows,
    notify: () => undefined,
    setStatus: () => undefined,
    setWidget: (_key, content) => {
      if (content !== undefined) rows.push(content)
    },
    select: () => Promise.resolve(undefined),
    confirm: () => Promise.resolve(false),
  }
}

function manager(): StatusUiManager {
  const listed: ListedTask = { record: task }
  return {
    list: () => [listed],
    wasBackground: () => true,
    runStatsSnapshot: () => stats,
  }
}

describe("createTaskStatusUi terminal width", () => {
  it("#given a 120-column terminal #when the production widget renders #then the row is bounded and keeps activity plus elapsed", () => {
    const ui = fakeUi()
    createTaskStatusUi({
      manager: manager(),
      runtime: { ui: () => ui, sessionId: () => "session-a", mode: () => "tui" },
      terminalWidth: () => 120,
      now: () => Date.parse("2026-07-07T00:01:00.000Z"),
    }).syncNow()

    const row = ui.rows.at(-1)?.[0] ?? ""
    expect(rendererVisibleWidth(row)).toBeLessThanOrEqual(120)
    expect(row).toContain("Plan the")
    expect(row).toContain("running")
    expect(row).toEndWith("1m 0s")
  })
})
