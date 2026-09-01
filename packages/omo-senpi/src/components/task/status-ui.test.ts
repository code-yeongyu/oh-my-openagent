import { describe, expect, it } from "bun:test"

import type { ListedTask, TaskRecord, TaskStatus } from "@oh-my-opencode/senpi-task"

import type { CapturedUi } from "./runtime-context"
import {
  createTaskStatusUi,
  type StatusUiManager,
  type StatusUiRuntime,
  type StatusUiTimers,
} from "./status-ui"

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

function fakeManager(records: readonly TaskRecord[]): StatusUiManager & { scopes: Array<{ scope: string; session_id: string }> } {
  const scopes: Array<{ scope: string; session_id: string }> = []
  return {
    scopes,
    list: (scope) => {
      if (scope.scope === "all") return listed(records)
      scopes.push(scope)
      return listed(records.filter((entry) => entry.parent_session_id === scope.session_id))
    },
  }
}

function runtimeOf(ui: FakeUi | undefined, sessionId = "session-a", mode = "tui"): StatusUiRuntime {
  return {
    ui: () => ui,
    sessionId: () => sessionId,
    mode: () => mode,
  }
}

describe("createTaskStatusUi.syncNow", () => {
  it("#given a list-only manager #when a static running row renders #then no animation timer starts", () => {
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
    const statusUi = createTaskStatusUi({
      manager: fakeManager([record({ task_id: "st_static", status: "running" })]),
      runtime: runtimeOf(fakeUi()),
      timers,
    })

    statusUi.syncNow()

    expect(active.size).toBe(0)
  })

  it("#given two running tasks in the current session #when syncing #then footer and two widget rows render scoped to the session", () => {
    const mine = [record({ task_id: "st_1", status: "running" }), record({ task_id: "st_2", status: "running" })]
    const other = record({ task_id: "st_other", status: "running", parent_session_id: "session-b", root_session_id: "session-b" })
    const manager = fakeManager([...mine, other])
    const ui = fakeUi()
    const statusUi = createTaskStatusUi({ manager, runtime: runtimeOf(ui) })

    statusUi.syncNow()

    // C1: the duplicated footer task status line is gone; only the belowEditor widget rows remain.
    expect(ui.statusCalls).toHaveLength(0)
    const widget = ui.widgetCalls.at(-1)
    expect(widget?.content).toHaveLength(2)
    expect(widget?.placement).toBe("belowEditor")
  })

  it("#given controls across a stale malformed running record #when syncing #then rows sanitize controls without damaging CJK", () => {
    const task = record({
      task_id: "st_\u001b[31mred\u001b[0m",
      name: "한국어\u0007 작업",
      status: "running",
      category: "ultra\u001b[2Jbrain",
      resolved_model: {
        provider: "openai",
        model_id: "gpt-5.6-sol",
        source: "category",
        display: "GPT\u001b]0;hidden\u001b\\-5.6 Sol",
        reasoning_effort: "xhigh\u0085",
        variant: "sol\u001bc",
      },
      final_response: "첫째\t둘째\n界 \u001b]8;;https://example.com/unterminated",
    })
    const ui = fakeUi()
    const statusUi = createTaskStatusUi({ manager: fakeManager([task]), runtime: runtimeOf(ui) })

    statusUi.syncNow()

    // C1: no footer status line is registered; the sanitized row lives only in the widget.
    expect(ui.statusCalls).toHaveLength(0)
    const widgetRow = ui.widgetCalls.at(-1)?.content?.[0] ?? ""
    expect(widgetRow).toContain("한")
    expect(widgetRow).toContain("category:ultrabrain")
    expect(widgetRow).toContain("openai/gpt-5.6-sol:xhigh")
    expect(widgetRow).toContain("in-process")
    expect(widgetRow).toContain("running")
    expect(widgetRow).not.toMatch(/[\u0000-\u001f\u007f-\u009f]/u)
  })

  it("#given no captured ui context #when syncing #then it is a no-op", () => {
    const manager = fakeManager([record({ task_id: "st_1", status: "running" })])
    createTaskStatusUi({ manager, runtime: runtimeOf(undefined) }).syncNow()
    expect(manager.scopes).toHaveLength(0)
  })

  it("#given a non-tui mode #when syncing #then UI is skipped", () => {
    const manager = fakeManager([record({ task_id: "st_1", status: "running" })])
    const ui = fakeUi()
    createTaskStatusUi({ manager, runtime: runtimeOf(ui, "session-a", "rpc") }).syncNow()
    expect(ui.statusCalls).toHaveLength(0)
    expect(ui.widgetCalls).toHaveLength(0)
  })

  it("#given a completed non-resident team record #when syncing #then the stale widget row is cleared", () => {
    const ui = fakeUi()
    const manager = {
      ...fakeManager([record({
        task_id: "st_stale",
        name: "team:12345678-1234-1234-1234-123456789abc:stale",
        status: "completed",
      })]),
      residentTaskIds: () => [],
    }
    createTaskStatusUi({ manager, runtime: runtimeOf(ui) }).syncNow()
    expect(ui.widgetCalls.at(-1)?.content).toBeUndefined()
  })
})

describe("createTaskStatusUi.scheduleSync", () => {
  it("#given a just-started background child #when scheduling #then it subscribes before debounce fires", () => {
    const active = new Map<number, () => void>()
    const timers: StatusUiTimers = {
      set: (callback) => {
        active.set(1, callback)
        return 1
      },
      clear: (handle) => { if (typeof handle === "number") active.delete(handle) },
    }
    const listeners = new Map<string, (event: { readonly type: string }) => void>()
    const manager: StatusUiManager = {
      list: () => listed([record({ task_id: "st_background", status: "running" })]),
      wasBackground: (taskId) => taskId === "st_background",
      subscribeChild: (taskId, listener) => {
        listeners.set(taskId, listener)
        return () => listeners.delete(taskId)
      },
    }
    const statusUi = createTaskStatusUi({ manager, runtime: runtimeOf(fakeUi()), timers })

    statusUi.scheduleSync()

    expect(listeners.has("st_background")).toBe(true)
    expect(active.size).toBe(1)
  })

  it("#given several rapid schedule calls #when debounce fires #then syncNow runs once", () => {
    const active = new Map<number, () => void>()
    let nextHandle = 1
    const timers: StatusUiTimers = {
      set: (callback) => {
        const handle = nextHandle++
        active.set(handle, callback)
        return handle
      },
      clear: (handle) => {
        if (typeof handle === "number") active.delete(handle)
      },
    }
    const ui = fakeUi()
    const statusUi = createTaskStatusUi({
      manager: fakeManager([record({ task_id: "st_1", status: "running" })]),
      runtime: runtimeOf(ui),
      timers,
    })

    statusUi.scheduleSync()
    statusUi.scheduleSync()
    statusUi.scheduleSync()
    expect(active.size).toBe(1)
    for (const callback of [...active.values()]) callback()
    // C1: debounce still coalesces to one syncNow, but no footer status is registered.
    expect(ui.statusCalls).toHaveLength(0)
    expect(ui.widgetCalls).toHaveLength(1)
  })

  it("#given a pending debounce #when disposed #then the timer clears without rendering", () => {
    const active = new Map<number, () => void>()
    let nextHandle = 1
    let cleared = 0
    const timers: StatusUiTimers = {
      set: (callback) => {
        const handle = nextHandle++
        active.set(handle, callback)
        return handle
      },
      clear: (handle) => {
        if (typeof handle === "number" && active.delete(handle)) cleared += 1
      },
    }
    const ui = fakeUi()
    const statusUi = createTaskStatusUi({
      manager: fakeManager([record({ task_id: "st_1", status: "running" })]),
      runtime: runtimeOf(ui),
      timers,
    })
    statusUi.scheduleSync()

    statusUi.dispose()

    expect(cleared).toBe(1)
    expect(active.size).toBe(0)
    expect(ui.statusCalls).toHaveLength(0)
  })
})
