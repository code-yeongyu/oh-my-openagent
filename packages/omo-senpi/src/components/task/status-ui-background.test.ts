import { describe, expect, it } from "bun:test"

import type { ListedTask, TaskRecord, TaskStatus } from "@oh-my-opencode/senpi-task"

import type { CapturedUi } from "./runtime-context"
import { createTaskStatusUi, type StatusUiManager, type StatusUiTimers } from "./status-ui"

function listed(records: readonly TaskRecord[]): readonly ListedTask[] {
  return records.map((entry) => ({ record: entry }))
}

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
    notification: { run_epoch: 0, notified_epoch: -1 },
    ...overrides,
  }
}

interface FakeUi extends CapturedUi {
  readonly statusCalls: Array<string | undefined>
  readonly widgetCalls: Array<{ content: string[] | undefined; placement: string | undefined }>
}

function fakeUi(): FakeUi {
  const statusCalls: Array<string | undefined> = []
  const widgetCalls: Array<{ content: string[] | undefined; placement: string | undefined }> = []
  return {
    statusCalls,
    widgetCalls,
    notify: () => undefined,
    setStatus: (_key, text) => statusCalls.push(text),
    setWidget: (_key, content, options) => widgetCalls.push({ content, placement: options?.placement }),
    select: () => Promise.resolve(undefined),
    confirm: () => Promise.resolve(false),
  }
}

describe("createTaskStatusUi.background progress", () => {
  it("#given two background children #when latest events arrive #then rows show identity, model, stats, activity, and elapsed time", () => {
    const active = new Map<number, () => void>()
    let nextHandle = 1
    const timers: StatusUiTimers = {
      set: (callback) => {
        const handle = nextHandle++
        active.set(handle, callback)
        return handle
      },
      clear: (handle) => { if (typeof handle === "number") active.delete(handle) },
    }
    const first = record({
      task_id: "st_first",
      name: "Investigate the unexpectedly long background child description",
      status: "running",
      category: "quick",
      model: "requested/model",
      resolved_model: {
        source: "category",
        provider: "quotio-openai",
        model_id: "gpt-5.4-mini-fast",
        display: "quotio-openai/gpt-5.4-mini-fast",
      },
    })
    const second = record({
      task_id: "st_second",
      name: "Review tests",
      status: "running",
      agent_type: "explore",
      model: "requested/model",
      resolved_model: {
        source: "agent",
        provider: "quotio-openai",
        model_id: "gpt-5.4-mini-fast",
        display: "quotio-openai/gpt-5.4-mini-fast",
      },
    })
    const listeners = new Map<string, (event: { readonly type: string; readonly toolName?: string; readonly args?: unknown }) => void>()
    const manager: StatusUiManager = {
      list: () => listed([first, second]),
      wasBackground: () => true,
      subscribeChild: (taskId, listener) => {
        listeners.set(taskId, listener)
        return () => listeners.delete(taskId)
      },
      runStatsSnapshot: (taskId) =>
        taskId === "st_first"
          ? { runtime_ms: 65_000, turns: 3, tool_calls: 7, tokens_per_second: 42 }
          : { runtime_ms: 65_000, turns: 1, tool_calls: 2 },
    }
    const ui = fakeUi()
    const statusUi = createTaskStatusUi({
      manager,
      runtime: { ui: () => ui, sessionId: () => "session-a", mode: () => "tui" },
      timers,
      now: () => Date.parse("2026-07-07T00:01:05.000Z"),
    })

    statusUi.syncNow()
    listeners.get("st_first")?.({ type: "tool_execution_start", toolName: "read", args: { path: "src/foo.ts" } })
    listeners.get("st_second")?.({ type: "tool_execution_start", toolName: "bash", args: { command: "bun test" } })
    expect(active.size).toBe(1)
    for (const callback of active.values()) callback()

    expect(ui.widgetCalls.at(-1)?.content).toEqual([
      "⠋ Investig... · category:quick · model:gpt-5.4-mini-fast · turn 3 (7 tools) · 42 tok/s · read src/foo.ts · 1m 5s",
      "⠋ Review t... · agent:explore · model:gpt-5.4-mini-fast · turn 1 (2 tools) · bash bun test · 1m 5s",
    ])
    expect(ui.statusCalls.at(-1)).toContain("Investig...")
    expect(ui.statusCalls.at(-1)).toContain("read src/foo.ts")
  })
})
