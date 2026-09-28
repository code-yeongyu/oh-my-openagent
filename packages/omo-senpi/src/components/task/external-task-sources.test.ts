import { describe, expect, it } from "bun:test"

import type { ListedTask, TaskRecord, TaskStatus } from "@oh-my-opencode/senpi-task"

import { FakeExtensionAPI } from "../../../test-support/fake-extension-api"
import { registerTaskCommands, type CommandManager } from "./commands"
import { fakeTaskRpcTimers } from "./event-bridge.test-fixtures"
import { wireHarness } from "./event-bridge.test-harness"
import {
  EXTERNAL_TASK_SOURCES_KEY,
  createExternalTaskSources,
  sharedExternalTaskSources,
  type ExternalTaskRow,
  type ExternalTaskSource,
} from "./external-task-sources"
import type { CapturedUi } from "./runtime-context"
import { createTaskStatusUi, type StatusUiManager, type StatusUiTimers } from "./status-ui"

const NOW = Date.parse("2026-09-28T04:00:00.000Z")

function row(overrides: Partial<ExternalTaskRow> & { id: string }): ExternalTaskRow {
  return { label: `agent-${overrides.id}`, status: "running", ...overrides }
}

function source(id: string, rows: readonly ExternalTaskRow[], sessionId?: string): ExternalTaskSource {
  return { id, label: "Claude Code", ...(sessionId === undefined ? {} : { sessionId }), list: () => rows }
}

function record(overrides: Partial<TaskRecord> & { task_id: string; status: TaskStatus }): TaskRecord {
  return {
    parent_session_id: "session-a",
    root_session_id: "session-a",
    depth: 0,
    execution_mode: "in-process",
    model: "anthropic/claude-sonnet-4-6",
    residency_state: "resident",
    created_at: "2026-09-28T03:59:00.000Z",
    updated_at: "2026-09-28T03:59:01.000Z",
    notification: { run_epoch: 0, notified_epoch: -1 },
    notify_on_terminal: false,
    ...overrides,
  }
}

function listed(records: readonly TaskRecord[]): readonly ListedTask[] {
  return records.map((entry) => ({ record: entry }))
}

function listManager(records: readonly TaskRecord[]): StatusUiManager & CommandManager {
  return {
    list: (scope) => listed(scope.scope === "all" ? records : records.filter((entry) => entry.parent_session_id === scope.session_id)),
    cancelTask: () => Promise.reject(new Error("cancel is not part of this test")),
  }
}

function widgetUi(): CapturedUi & { readonly widgets: Array<string[] | undefined> } {
  const widgets: Array<string[] | undefined> = []
  return {
    widgets,
    notify: () => undefined,
    setStatus: () => undefined,
    setWidget: (_key, content) => widgets.push(content),
    select: () => Promise.resolve(undefined),
    confirm: () => Promise.resolve(false),
  }
}

function manualTimers(): StatusUiTimers & { readonly fire: () => void; readonly pending: () => number } {
  const queued = new Map<number, () => void>()
  let next = 1
  return {
    set: (callback) => {
      const handle = next++
      queued.set(handle, callback)
      return handle
    },
    clear: (handle) => { if (typeof handle === "number") queued.delete(handle) },
    fire: () => {
      const due = [...queued.values()]
      queued.clear()
      for (const callback of due) callback()
    },
    pending: () => queued.size,
  }
}

describe("createExternalTaskSources", () => {
  it("#given scoped and unscoped sources #when snapshotting one session #then only that session's and unscoped rows return", () => {
    const registry = createExternalTaskSources()
    registry.register(source("cc-a", [row({ id: "a1" })], "session-a"))
    registry.register(source("cc-b", [row({ id: "b1" })], "session-b"))
    registry.register(source("global", [row({ id: "g1" })]))

    const scoped = registry.snapshot("session-a").flatMap((snapshot) => snapshot.rows.map((entry) => entry.id))
    const all = registry.snapshot("session-a", { allSessions: true }).flatMap((snapshot) => snapshot.rows.map((entry) => entry.id))

    expect(scoped.sort()).toEqual(["a1", "g1"])
    expect(all.sort()).toEqual(["a1", "b1", "g1"])
  })

  it("#given a source re-registered under the same id and session #when the stale handle unregisters #then the replacement stays", () => {
    const registry = createExternalTaskSources()
    const unregisterOld = registry.register(source("cc", [row({ id: "old" })], "session-a"))
    const unregisterNew = registry.register(source("cc", [row({ id: "new" })], "session-a"))

    unregisterOld()
    const afterStale = registry.snapshot("session-a").flatMap((snapshot) => snapshot.rows.map((entry) => entry.id))
    unregisterNew()

    expect(afterStale).toEqual(["new"])
    expect(registry.snapshot("session-a")).toEqual([])
  })

  it("#given malformed rows and control characters #when snapshotting #then invalid rows drop and text is sanitized", () => {
    const registry = createExternalTaskSources()
    const rows = [
      row({ id: "ok", label: "review\u001b[31m:lens\u0007", activity: "Read\u001b]0;x\u0007 a.ts", startedAt: NOW - 60_000 }),
      { id: "", label: "no id", status: "running" },
      { id: "bad-status", label: "x", status: "exploded" },
      { id: "no-label", status: "running" },
      "not an object",
    ] as unknown as readonly ExternalTaskRow[]
    registry.register(source("cc", rows, "session-a"))

    const [snapshot] = registry.snapshot("session-a")

    expect(snapshot?.rows.map((entry) => entry.id)).toEqual(["ok"])
    expect(snapshot?.rows[0]?.label).not.toContain("\u001b")
    expect(snapshot?.rows[0]?.label).not.toContain("\u0007")
    expect(snapshot?.rows[0]?.activity).not.toContain("\u001b")
  })

  it("#given a source whose list throws #when snapshotting #then its rows are skipped, the error is reported and other sources still list", () => {
    const failures: string[] = []
    const registry = createExternalTaskSources((sourceId) => failures.push(sourceId))
    registry.register({ id: "broken", label: "Broken", list: () => { throw new Error("disk gone") } })
    registry.register(source("cc", [row({ id: "a1" })]))

    const ids = registry.snapshot("session-a").map((snapshot) => snapshot.sourceId)

    expect(ids).toEqual(["cc"])
    expect(failures).toEqual(["broken"])
  })

  it("#given a subscriber #when sources register, change and unregister #then it is notified each time until it unsubscribes", () => {
    const registry = createExternalTaskSources()
    let calls = 0
    const unsubscribe = registry.subscribe(() => { calls += 1 })

    const unregister = registry.register(source("cc", [row({ id: "a1" })]))
    registry.changed()
    unregister()
    unsubscribe()
    registry.changed()

    expect(calls).toBe(3)
  })

  it("#given two lookups of the shared registry #when compared #then both resolve the one globalThis instance", () => {
    const first = sharedExternalTaskSources()
    const second = sharedExternalTaskSources()

    expect(second).toBe(first)
    expect((globalThis as unknown as Record<symbol, unknown>)[EXTERNAL_TASK_SOURCES_KEY]).toBe(first)
  })
})

describe("createTaskStatusUi with external sources", () => {
  it("#given a native task and running plus done external agents #when syncing #then external running rows follow the native rows", () => {
    const registry = createExternalTaskSources()
    registry.register(source("cc", [
      row({ id: "r1", label: "review:lens-a", phase: "Review", model: "opus", activity: "Read a.ts", startedAt: NOW - 60_000 }),
      row({ id: "d1", label: "fixup:r1", status: "done" }),
    ], "session-a"))
    const ui = widgetUi()
    const statusUi = createTaskStatusUi({
      manager: listManager([record({ task_id: "st_native", status: "running" })]),
      runtime: { ui: () => ui, sessionId: () => "session-a", mode: () => "tui" },
      externalSources: registry,
      now: () => NOW,
    })

    statusUi.syncNow()

    const rows = ui.widgets.at(-1) ?? []
    expect(rows).toHaveLength(2)
    expect(rows[0]).toContain("st_native")
    expect(rows[1]).toBe("↗ review:lens-a · Claude Code · Review · opus · Read a.ts · 1m 0s")
    expect(rows.join("\n")).not.toContain("fixup:r1")
  })

  it("#given only external rows #when the source changes and then unregisters #then the widget repaints and finally clears", () => {
    const registry = createExternalTaskSources()
    let rows: readonly ExternalTaskRow[] = [row({ id: "r1", label: "review:lens-a" })]
    const unregister = registry.register({ id: "cc", label: "Claude Code", sessionId: "session-a", list: () => rows })
    const ui = widgetUi()
    const timers = manualTimers()
    const statusUi = createTaskStatusUi({
      manager: listManager([]),
      runtime: { ui: () => ui, sessionId: () => "session-a", mode: () => "tui" },
      externalSources: registry,
      timers,
      now: () => NOW,
    })
    statusUi.syncNow()

    rows = [row({ id: "r1", label: "review:lens-a", status: "stalled", lastActivityAt: NOW - 11 * 60_000 })]
    registry.changed()
    timers.fire()
    const stalled = ui.widgets.at(-1)
    unregister()
    timers.fire()

    expect(stalled).toEqual(["! review:lens-a · Claude Code · stalled 11m 0s"])
    expect(ui.widgets.at(-1)).toBeUndefined()
  })

  it("#given a disposed status UI #when an external source changes #then no repaint is scheduled", () => {
    const registry = createExternalTaskSources()
    const timers = manualTimers()
    const statusUi = createTaskStatusUi({
      manager: listManager([]),
      runtime: { ui: () => widgetUi(), sessionId: () => "session-a", mode: () => "tui" },
      externalSources: registry,
      timers,
    })

    statusUi.dispose()
    registry.changed()

    expect(timers.pending()).toBe(0)
  })
})

describe("/tasks with external sources", () => {
  async function runTasks(registry: ReturnType<typeof createExternalTaskSources>, records: readonly TaskRecord[]): Promise<string[]> {
    const pi = new FakeExtensionAPI()
    registerTaskCommands(pi, listManager(records), registry)
    const notifications: string[] = []
    const command = pi.commands.find((entry) => entry.name === "tasks")
    const handler = command?.options["handler"] as (args: string, ctx: unknown) => Promise<void>
    await handler("", {
      mode: "tui",
      ui: { notify: (message: string) => notifications.push(message), select: () => Promise.resolve(undefined), confirm: () => Promise.resolve(false) },
      sessionManager: { getSessionId: () => "session-a" },
    })
    return notifications
  }

  it("#given external agents in every state #when /tasks runs #then each is listed as read-only after native tasks", async () => {
    const registry = createExternalTaskSources()
    registry.register(source("claude-code-workflow", [
      row({ id: "r1", label: "review:lens-a", phase: "Review", model: "opus", activity: "Read a.ts" }),
      row({ id: "d1", label: "fixup:r1", status: "done" }),
    ], "session-a"))

    const [text] = await runTasks(registry, [record({ task_id: "st_native", status: "running" })])

    const lines = text?.split("\n") ?? []
    expect(lines).toHaveLength(3)
    expect(lines[0]).toContain("st_native")
    expect(lines[1]).toBe("review:lens-a (claude-code-workflow:r1) status:running phase:Review model:opus activity:Read a.ts external:read-only")
    expect(lines[2]).toBe("fixup:r1 (claude-code-workflow:d1) status:done external:read-only")
  })

  it("#given no native or external tasks #when /tasks runs #then the empty message still reads", async () => {
    expect(await runTasks(createExternalTaskSources(), [])).toEqual(["No tasks in this session."])
  })
})

describe("omo.task.updated with external sources", () => {
  it("#given scoped external rows #when session_start emits #then external_tasks carries this session's rows only", async () => {
    const registry = createExternalTaskSources()
    registry.register(source("cc", [row({ id: "r1", label: "review:lens-a", phase: "Review", startedAt: NOW })], "parent-session"))
    registry.register(source("cc", [row({ id: "x1" })], "other-session"))
    const { pi } = wireHarness("parent-session", { withRpc: true, externalSources: registry })

    await pi.dispatch("session_start", {}, {})

    const event = pi.rpcEvents.find((entry) => entry.name === "omo.task.updated")
    expect(event?.data).toMatchObject({
      parent_session_id: "parent-session",
      tasks: [],
      external_tasks: [{
        source_id: "cc",
        source_label: "Claude Code",
        id: "r1",
        label: "review:lens-a",
        status: "running",
        phase: "Review",
        started_at: "2026-09-28T04:00:00.000Z",
      }],
    })
    expect(JSON.stringify(event?.data)).not.toContain("x1")
  })

  it("#given an attached bridge #when an external source changes #then one coalesced snapshot carries the new activity", async () => {
    const registry = createExternalTaskSources()
    let activity = "Read a.ts"
    registry.register({ id: "cc", label: "Claude Code", sessionId: "parent-session", list: () => [row({ id: "r1", activity })] })
    const clock = fakeTaskRpcTimers()
    const { pi } = wireHarness("parent-session", { withRpc: true, externalSources: registry, taskRpcTimers: clock.timers })
    await pi.dispatch("session_start", {}, {})
    const before = pi.rpcEvents.length

    activity = "Bash bun test"
    registry.changed()
    registry.changed()
    clock.advance()

    expect(pi.rpcEvents).toHaveLength(before + 1)
    expect(pi.rpcEvents.at(-1)?.data).toMatchObject({ external_tasks: [{ id: "r1", activity: "Bash bun test" }] })
  })

  it("#given an external row id #when RPC send or cancel targets it #then both are refused and nothing reaches the task manager", async () => {
    const registry = createExternalTaskSources()
    registry.register(source("cc", [row({ id: "r1" })], "parent-session"))
    const { pi, invokeRpc, sendCalls, cancelCalls } = wireHarness("parent-session", { withRpc: true, externalSources: registry })
    await pi.dispatch("session_start", {}, {})

    const send = await invokeRpc("omo.task.send", { to: "r1", message: "stop" })
    const cancel = await invokeRpc("omo.task.cancel", { task_id: "r1" })

    expect(send).toMatchObject({ kind: "invalid_arguments" })
    expect(cancel).toMatchObject({ kind: "invalid_arguments" })
    expect(sendCalls).toEqual([])
    expect(cancelCalls).toEqual([])
  })
})
