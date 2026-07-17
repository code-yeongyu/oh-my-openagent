import { describe, expect, it } from "bun:test"

import { rendererVisibleWidth, type ListedTask, type TaskRecord, type TaskStatus } from "@oh-my-opencode/senpi-task"

import type { CapturedUi } from "./runtime-context"
import {
  buildWidgetRows,
  createTaskStatusUi,
  formatFooterStatus,
  formatTaskRow,
  type StatusUiManager,
  type StatusUiRuntime,
  type StatusUiTimers,
} from "./status-ui"

// allow: SIZE_OK - status formatting and captured-UI behavior share one focused fixture surface.

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

function longActiveRecord(): TaskRecord {
  return record({
    task_id: "st_01active0123456789",
    name: "active-child",
    status: "running",
    category: "ultrabrain",
    resolved_model: {
      provider: "omo-mock",
      model_id: "mock-1",
      display: "omo-mock/mock-1",
      reasoning_effort: "xhigh",
      variant: "xhigh",
      source: "category",
    },
  })
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
  it("#given two running tasks #when formatting the footer #then compact active counts and a task tail render", () => {
    // given
    const records = [record({ task_id: "st_aaaa", status: "running" }), record({ task_id: "st_bbbb", status: "running" })]

    // when
    const footer = formatFooterStatus(records)

    // then
    expect(footer).toContain("t2/r2")
    expect(footer).toContain("st_aaaa")
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

  it("#given a 137-column active task #when formatting the footer #then it remains one physical line at 72 and 120 columns", () => {
    // given / when
    const footer = formatFooterStatus([longActiveRecord()]) ?? ""

    // then
    expect(footer).not.toContain("\n")
    for (const columns of [72, 120]) expect(rendererVisibleWidth(footer)).toBeLessThanOrEqual(columns)
    expect(footer).toBe("t1/r1 st_01acti...|c:ultrabrain omo-mock/mock-1 xhigh in-process running")
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

  it("#given an active task #when building a row #then it retains useful id, target, model, mode, and status context", () => {
    // given
    const records = [
      record({ task_id: "st_row", name: "finder", status: "running", agent_type: "explore", pid: 4242 }),
    ]

    // when
    const row = buildWidgetRows(records)[0] ?? ""

    // then
    expect(row).toContain("st_row")
    expect(row).toContain("a:explore")
    expect(row).toContain("anthropic/")
    expect(row).toContain("in-process")
    expect(row).toContain("running")
    expect(rendererVisibleWidth(row)).toBeLessThanOrEqual(72)
  })

  it("#given a 137-column active task #when building its widget row #then it remains one physical line at 72 and 120 columns", () => {
    // given / when
    const row = buildWidgetRows([longActiveRecord()])[0] ?? ""

    // then
    expect(row).not.toContain("\n")
    for (const columns of [70, 72, 120]) expect(rendererVisibleWidth(row)).toBeLessThanOrEqual(columns)
    expect(row).toContain("c:ultrabrain")
    expect(row).toContain("omo-mock/mock-1")
    expect(row).toContain("xhigh")
    expect(row).toContain("in-process")
    expect(row).toContain("running")
  })
})

describe("formatTaskRow", () => {
  it("#given a category task with resolved model metadata #when formatting #then category, display model, reasoning, variant, mode, and status render in one order", () => {
    // given
    const task = record({
      task_id: "st_resolved",
      name: "planner",
      status: "running",
      category: "ultrabrain",
      execution_mode: "rpc",
      model: "category/raw-fallback",
      resolved_model: {
        provider: "openai",
        model_id: "gpt-5.6-sol",
        display: "openai/gpt-5.6-sol",
        reasoning_effort: "xhigh",
        variant: "sol",
        source: "category",
      },
    })

    // when
    const row = formatTaskRow(task)

    // then
    expect(row).toBe(
      "st_resolved planner category:ultrabrain model:openai/gpt-5.6-sol reasoning:xhigh variant:sol mode:rpc status:running",
    )
  })

  it("#given a legacy task without resolved model metadata #when formatting #then raw model is preserved as the model label", () => {
    // given
    const task = record({
      task_id: "st_legacy",
      status: "running",
      agent_type: "explore",
      model: "anthropic/claude-sonnet-4-6",
    })

    // when
    const row = formatTaskRow(task)

    // then
    expect(row).toBe("st_legacy agent:explore model:anthropic/claude-sonnet-4-6 mode:in-process status:running")
  })

  it("#given empty resolved model detail labels #when formatting #then empty reasoning and variant labels are omitted", () => {
    // given
    const task = record({
      task_id: "st_empty",
      status: "running",
      category: "ultrabrain",
      model: "category/raw-fallback",
      resolved_model: {
        provider: "google",
        model_id: "gemini-3.1-pro",
        display: "google/gemini-3.1-pro",
        reasoning_effort: "",
        variant: "",
        source: "category",
      },
    })

    // when
    const row = formatTaskRow(task)

    // then
    expect(row).toBe("st_empty category:ultrabrain model:google/gemini-3.1-pro mode:in-process status:running")
  })

  it("#given matching reasoning and variant values #when formatting #then the duplicate variant label is omitted", () => {
    // given / when
    const row = formatTaskRow(longActiveRecord())

    // then
    expect(row).toContain("reasoning:xhigh")
    expect(row).not.toContain("variant:xhigh")
  })

  it("#given a stale malformed running record with final_response #when formatting defensively #then the progress excerpt is terminal-width safe and concise", () => {
    // given a stale persisted record; normal lifecycle progress does not set final_response while running
    const task = record({
      task_id: "st_cjk",
      status: "running",
      agent_type: "explore",
      final_response: `${"界".repeat(40)}tail`,
    })

    // when
    const row = formatTaskRow(task)
    const progressPrefix = " progress:"
    const progressIndex = row.indexOf(progressPrefix)
    const progress = progressIndex >= 0 ? row.slice(progressIndex + progressPrefix.length) : ""

    // then
    expect(progress).toContain("...")
    expect(progress).not.toContain("tail")
    expect(rendererVisibleWidth(progress)).toBeLessThanOrEqual(60)
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
    expect(ui.statusCalls.at(-1)).toContain("t2/r2")
    // widget shows the two session-a rows below the editor
    const widget = ui.widgetCalls.at(-1)
    expect(widget?.content).toHaveLength(2)
    expect(widget?.placement).toBe("belowEditor")
  })

  it("#given controls across a stale malformed running record with final_response #when syncing defensively #then the row widget and footer are sanitized without damaging CJK text", () => {
    // given a stale persisted record; normal lifecycle progress does not set final_response while running
    const task = record({
      task_id: "st_\u001b[31mred\u001b[0m", name: "한국어\u0007 작업",
      status: "running", category: "ultra\u001b[2Jbrain",
      resolved_model: { provider: "openai", model_id: "gpt-5.6-sol", source: "category", display: "GPT\u001b]0;hidden\u001b\\-5.6 Sol", reasoning_effort: "xhigh\u0085", variant: "sol\u001bc" },
      final_response: "첫째\t둘째\n界 \u001b]8;;https://example.com/unterminated",
    })
    const ui = fakeUi()
    const statusUi = createTaskStatusUi({ manager: fakeManager([task]), runtime: runtimeOf(ui, "session-a", "tui") })

    // when
    statusUi.syncNow()

    // then
    const footer = ui.statusCalls.at(-1) ?? ""
    const widgetRow = ui.widgetCalls.at(-1)?.content?.[0] ?? ""
    expect(rendererVisibleWidth(widgetRow)).toBeLessThanOrEqual(70)
    expect(rendererVisibleWidth(footer)).toBeLessThanOrEqual(72)
    expect(widgetRow).toContain("한")
    expect(widgetRow).toContain("c:ultrabrain")
    expect(widgetRow).toContain("GPT-5.6 Sol")
    expect(widgetRow).toContain("xhigh")
    expect(widgetRow).toContain("in-process")
    expect(widgetRow).toContain("running")
    expect(footer).toContain("t1/r1")
    expect(`${footer} ${widgetRow}`).not.toMatch(/[\u0000-\u001f\u007f-\u009f]/u)
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
        if (typeof handle === "number") active.delete(handle)
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

  it("#given a pending debounce #when dispose is called #then the timer is cleared and syncNow never runs", () => {
    // given a controllable timer with a pending scheduled sync
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
    const manager = fakeManager([record({ task_id: "st_1", status: "running" })])
    const statusUi = createTaskStatusUi({ manager, runtime: runtimeOf(ui, "session-a", "tui"), timers })
    statusUi.scheduleSync()
    expect(active.size).toBe(1)

    // when the component is disposed before the debounce elapses
    statusUi.dispose()

    // then the pending timer is cleared and no render happens
    expect(cleared).toBe(1)
    expect(active.size).toBe(0)
    expect(ui.statusCalls).toHaveLength(0)
  })
})
