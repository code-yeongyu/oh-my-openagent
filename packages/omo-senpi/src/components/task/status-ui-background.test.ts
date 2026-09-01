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
    notify_on_terminal: false,
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
  it("#given a completed resident team member #when syncing #then its settled row remains without a refresh timer", () => {
    // given
    const active = new Map<number, () => void>()
    const timers: StatusUiTimers = {
      set: (callback) => { active.set(1, callback); return 1 },
      clear: (handle) => { if (typeof handle === "number") active.delete(handle) },
    }
    const member = record({
      task_id: "st_done",
      name: "team:12345678-1234-1234-1234-123456789abc:researcher",
      task_summary: "settled researcher",
      status: "completed",
    })
    const manager = {
      list: () => listed([member, record({ task_id: "st_ordinary", task_summary: "ordinary task", status: "completed" })]),
      wasBackground: () => true,
      residentTaskIds: () => [member.task_id, "st_ordinary"],
    }
    const ui = fakeUi()
    const statusUi = createTaskStatusUi({ manager, runtime: { ui: () => ui, sessionId: () => "session-a", mode: () => "tui" }, timers })

    // when
    statusUi.syncNow()

    // then
    const rows = ui.widgetCalls.at(-1)?.content ?? []
    expect(active.size).toBe(0)
    expect(rows).toHaveLength(1)
    expect(rows[0]).toContain("settled researcher")
    expect(rows[0]).toContain("completed")
    expect(rows[0]).not.toStartWith("⠋ ")
    expect(rows.join("\n")).not.toContain("ordinary task")
  })

  it("#given an idle parent with a running background task #when time advances quietly #then live status refreshes", () => {
    // given
    let currentTime = Date.parse("2026-07-07T00:00:00.000Z")
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
    const task = record({
      task_id: "st_idle",
      name: "Idle child",
      status: "running",
      category: "quick",
      created_at: new Date(currentTime).toISOString(),
    })
    let stats = { runtime_ms: 0, turns: 1, tool_calls: 2, tokens_per_second: 40 }
    let listCalls = 0
    const manager: StatusUiManager = {
      list: () => {
        listCalls += 1
        return listed([task])
      },
      wasBackground: () => true,
      subscribeChild: () => () => undefined,
      runStatsSnapshot: () => stats,
    }
    const ui = fakeUi()
    const statusUi = createTaskStatusUi({
      manager,
      runtime: { ui: () => ui, sessionId: () => "session-a", mode: () => "tui" },
      timers,
      now: () => currentTime,
    })
    statusUi.syncNow()
    const first = ui.widgetCalls.at(-1)?.content?.[0] ?? ""
    expect(listCalls).toBe(1)

    // when
    currentTime += 1_000
    stats = { runtime_ms: 1_000, turns: 2, tool_calls: 3, tokens_per_second: 42 }
    expect(active.size).toBe(1)
    for (const callback of [...active.values()]) callback()
    const second = ui.widgetCalls.at(-1)?.content?.[0] ?? ""

    // then
    expect(first).toContain("turn 1 (2 tools)")
    expect(first).toContain("40 tok/s")
    expect(first).toContain("0s")
    expect(second).toContain("turn 2 (3 tools)")
    expect(second).toContain("42 tok/s")
    expect(second).toContain("1s")
    expect(second[0]).not.toBe(first[0])
    expect(listCalls).toBe(1)
  })

  it("#given a live refresh timer #when the final background task completes #then the timer stops", () => {
    // given
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
    let task = record({ task_id: "st_finishing", status: "running" })
    const manager: StatusUiManager = {
      list: () => listed([task]),
      wasBackground: () => true,
      subscribeChild: () => () => undefined,
    }
    const ui = fakeUi()
    const statusUi = createTaskStatusUi({
      manager,
      runtime: { ui: () => ui, sessionId: () => "session-a", mode: () => "tui" },
      timers,
    })
    statusUi.syncNow()
    expect(active.size).toBe(1)

    // when
    task = record({ task_id: "st_finishing", status: "completed" })
    statusUi.scheduleSync()
    for (const callback of [...active.values()]) callback()

    // then
    expect(active.size).toBe(0)
    expect(ui.widgetCalls.at(-1)?.content).toBeUndefined()
  })

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
        provider: "openai-codex",
        model_id: "gpt-5.6-luna-fast",
        display: "openai-codex/gpt-5.6-luna-fast",
        reasoning_effort: "high",
      },
      fallback_attempts: [
        {
          source: "category",
          provider: "anthropic",
          model_id: "claude-haiku-4-5",
          display: "anthropic/claude-haiku-4-5",
        },
        {
          source: "category",
          provider: "openai-codex",
          model_id: "gpt-5.6-luna-fast",
          display: "openai-codex/gpt-5.6-luna-fast",
          reasoning_effort: "high",
        },
      ],
    })
    const second = record({
      task_id: "st_second",
      name: "Review tests",
      status: "running",
      agent_type: "explore",
      model: "requested/model",
      resolved_model: {
        source: "agent",
        provider: "openai-codex",
        model_id: "gpt-5.6-luna-fast",
        display: "openai-codex/gpt-5.6-luna-fast",
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
      timers, terminalWidth: () => 220,
      now: () => Date.parse("2026-07-07T00:01:05.000Z"),
    })

    statusUi.syncNow()
    listeners.get("st_first")?.({ type: "tool_execution_start", toolName: "read", args: { path: "src/foo.ts" } })
    listeners.get("st_second")?.({ type: "tool_execution_start", toolName: "bash", args: { command: "bun test" } })
    expect(active.size).toBe(1)
    for (const callback of [...active.values()]) callback()

    expect(ui.widgetCalls.at(-1)?.content).toEqual([
      "⠋ Investigate the unexpectedly long background child description · category:quick(openai-codex/gpt-5.6-luna-fast:high) · fallback:2 · turn 3 (7 tools) · 42 tok/s · read src/foo.ts · 1m 5s",
      "⠋ Review tests · agent:explore(openai-codex/gpt-5.6-luna-fast) · turn 1 (2 tools) · bash bun test · 1m 5s",
    ])
    // C1: the duplicated footer task status line is gone; widget rows are the only task surface.
    expect(ui.statusCalls).toHaveLength(0)
  })
})
