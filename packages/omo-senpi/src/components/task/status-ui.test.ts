import { describe, expect, it } from "bun:test"

import type { ListedTask, TaskRecord, TaskStatus } from "@oh-my-opencode/senpi-task"

import type { CapturedUi } from "./runtime-context"
import {
  buildWidgetRows,
  createTaskStatusUi,
  formatFooterStatus,
  type StatusUiManager,
  type StatusUiRuntime,
  type StatusUiTimers,
} from "./status-ui"

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

function listed(records: readonly TaskRecord[]): readonly ListedTask[] {
  return records.map((rec) => ({ record: rec }))
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

function fakeManager(records: readonly TaskRecord[]): StatusUiManager & { scopes: unknown[] } {
  const scopes: unknown[] = []
  return {
    scopes,
    list: (scope) => {
      scopes.push(scope)
      if (scope.scope === "all") return listed(records)
      return listed(records.filter((rec) => rec.parent_session_id === scope.session_id || rec.root_session_id === scope.session_id))
    },
  }
}

function runtimeOf(ui: CapturedUi | undefined, sessionId: string | undefined, mode: string | undefined): StatusUiRuntime {
  return { ui: () => ui, sessionId: () => sessionId, mode: () => mode }
}

describe("formatFooterStatus", () => {
  it("#given two running tasks #when formatting the footer #then all four counts and an active tail render", () => {
    // given
    const records = [record({ task_id: "st_aaaa", status: "running" }), record({ task_id: "st_bbbb", status: "running" })]

    // when
    const footer = formatFooterStatus(records)

    // then
    expect(footer).toContain("tasks:2 run:2 done:0 err:0")
    expect(footer).toContain("| st_aaaa")
  })

  it("#given no tasks #when formatting the footer #then it is undefined so the status clears", () => {
    // given / when / then
    expect(formatFooterStatus([])).toBeUndefined()
  })

  it("#given errored and completed terminals #when formatting #then done and err counts are distinct", () => {
    // given
    const records = [
      record({ task_id: "st_a", status: "completed" }),
      record({ task_id: "st_b", status: "error" }),
      record({ task_id: "st_c", status: "lost" }),
    ]

    // when
    const footer = formatFooterStatus(records) ?? ""

    // then all three terminal, two of them error-like (error + lost)
    expect(footer).toContain("run:0")
    expect(footer).toContain("done:3")
    expect(footer).toContain("err:2")
  })
})

describe("buildWidgetRows", () => {
  it("#given more than five active tasks #when building rows #then it caps at five and adds a +N more row", () => {
    // given seven running tasks
    const records = Array.from({ length: 7 }, (_v, index) => record({ task_id: `st_${index}`, status: "running" }))

    // when
    const rows = buildWidgetRows(records)

    // then
    expect(rows).toHaveLength(6)
    expect(rows[5]).toBe("+2 more")
  })

  it("#given only terminal tasks #when building rows #then no rows render (widget clears)", () => {
    // given
    const records = [record({ task_id: "st_done", status: "completed" })]

    // when / then
    expect(buildWidgetRows(records)).toHaveLength(0)
  })

  it("#given an active task #when building a row #then it carries id, agent, state, mode, model", () => {
    // given
    const records = [
      record({ task_id: "st_row", name: "finder", status: "running", agent_type: "explore", pid: 4242 }),
    ]

    // when
    const row = buildWidgetRows(records)[0] ?? ""

    // then
    expect(row).toContain("st_row")
    expect(row).toContain("finder")
    expect(row).toContain("agent:explore")
    expect(row).toContain("running")
    expect(row).toContain("mode:in-process")
    expect(row).toContain("pid:4242")
  })
})

describe("createTaskStatusUi.syncNow", () => {
  it("#given two running tasks in the current session #when syncing #then footer and two widget rows render scoped to the session", () => {
    // given tasks split across two sessions
    const mine = [record({ task_id: "st_1", status: "running" }), record({ task_id: "st_2", status: "running" })]
    const other = record({ task_id: "st_other", status: "running", parent_session_id: "session-b", root_session_id: "session-b" })
    const manager = fakeManager([...mine, other])
    const ui = fakeUi()
    const statusUi = createTaskStatusUi({ manager, runtime: runtimeOf(ui, "session-a", "tui") })

    // when
    statusUi.syncNow()

    // then footer counts scoped to session-a only (2 tasks, not 3)
    expect(ui.statusCalls.at(-1)).toContain("tasks:2 run:2")
    // widget shows the two session-a rows below the editor
    const widget = ui.widgetCalls.at(-1)
    expect(widget?.content).toHaveLength(2)
    expect(widget?.placement).toBe("belowEditor")
  })

  it("#given no captured ui context #when syncing #then it is a no-op", () => {
    // given a runtime whose ui was cleared on switch/shutdown
    const manager = fakeManager([record({ task_id: "st_1", status: "running" })])
    const statusUi = createTaskStatusUi({ manager, runtime: runtimeOf(undefined, "session-a", "tui") })

    // when / then it must not throw and must not query the manager
    statusUi.syncNow()
    expect(manager.scopes).toHaveLength(0)
  })

  it("#given a non-tui mode #when syncing #then UI is skipped", () => {
    // given a captured ui but rpc mode
    const manager = fakeManager([record({ task_id: "st_1", status: "running" })])
    const ui = fakeUi()
    const statusUi = createTaskStatusUi({ manager, runtime: runtimeOf(ui, "session-a", "rpc") })

    // when
    statusUi.syncNow()

    // then nothing rendered
    expect(ui.statusCalls).toHaveLength(0)
    expect(ui.widgetCalls).toHaveLength(0)
  })

  it("#given all tasks terminal #when syncing #then the widget is cleared", () => {
    // given
    const manager = fakeManager([record({ task_id: "st_done", status: "completed" })])
    const ui = fakeUi()
    const statusUi = createTaskStatusUi({ manager, runtime: runtimeOf(ui, "session-a", "tui") })

    // when
    statusUi.syncNow()

    // then setWidget was called with undefined content to clear the widget
    expect(ui.widgetCalls.at(-1)?.content).toBeUndefined()
  })
})

describe("createTaskStatusUi.scheduleSync", () => {
  it("#given several rapid schedule calls #when the debounce fires #then syncNow runs once (250ms debounce)", () => {
    // given a controllable timer
    const active = new Map<number, () => void>()
    let nextHandle = 1
    const timers: StatusUiTimers = {
      set: (callback) => {
        const handle = nextHandle++
        active.set(handle, callback)
        return handle
      },
      clear: (handle) => {
        active.delete(handle as number)
      },
    }
    const ui = fakeUi()
    const manager = fakeManager([record({ task_id: "st_1", status: "running" })])
    const statusUi = createTaskStatusUi({ manager, runtime: runtimeOf(ui, "session-a", "tui"), timers })

    // when three transitions fire back to back
    statusUi.scheduleSync()
    statusUi.scheduleSync()
    statusUi.scheduleSync()

    // then only one debounce timer is pending
    expect(active.size).toBe(1)

    // when the debounce elapses
    for (const callback of [...active.values()]) callback()

    // then exactly one sync ran
    expect(ui.statusCalls).toHaveLength(1)
  })
})
