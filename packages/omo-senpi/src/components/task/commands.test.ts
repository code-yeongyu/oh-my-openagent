import { describe, expect, it } from "bun:test"

import type { CancelOutcome, ListedTask, TaskRecord, TaskStatus } from "@oh-my-opencode/senpi-task"

import { FakeExtensionAPI } from "../../../test-support/fake-extension-api"
import { registerTaskCommands, type CommandManager } from "./commands"

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

function fakeManager(records: readonly TaskRecord[]): CommandManager & { cancelled: string[] } {
  const cancelled: string[] = []
  return {
    cancelled,
    list: (scope) => {
      if (scope.scope === "all") return listed(records)
      return listed(records.filter((rec) => rec.parent_session_id === scope.session_id || rec.root_session_id === scope.session_id))
    },
    cancelTask: (idOrName) => {
      cancelled.push(idOrName)
      const outcome: CancelOutcome = { kind: "cancelled", task_id: idOrName, previous_status: "running" }
      return Promise.resolve(outcome)
    },
  }
}

interface FakeCommandUi {
  readonly notifications: string[]
  readonly selectCalls: Array<{ title: string; options: string[] }>
  select: (title: string, options: string[]) => Promise<string | undefined>
  confirm: (title: string, message: string) => Promise<boolean>
  notify: (message: string) => void
}

function commandCtx(
  sessionId: string | undefined,
  mode: string,
  ui: {
    select?: (title: string, options: string[]) => Promise<string | undefined>
    confirm?: (title: string, message: string) => Promise<boolean>
  } = {},
): { ctx: unknown; ui: FakeCommandUi } {
  const notifications: string[] = []
  const selectCalls: Array<{ title: string; options: string[] }> = []
  const uiImpl: FakeCommandUi = {
    notifications,
    selectCalls,
    select: (title, options) => {
      selectCalls.push({ title, options })
      return (ui.select ?? (() => Promise.resolve(undefined)))(title, options)
    },
    confirm: ui.confirm ?? (() => Promise.resolve(true)),
    notify: (message) => notifications.push(message),
  }
  const ctx = {
    mode,
    hasUI: mode === "tui",
    ui: uiImpl,
    sessionManager: { getSessionId: () => sessionId ?? "unknown" },
  }
  return { ctx, ui: uiImpl }
}

async function invoke(pi: FakeExtensionAPI, name: string, args: string, ctx: unknown): Promise<void> {
  const command = pi.commands.find((entry) => entry.name === name)
  if (command === undefined) throw new Error(`command ${name} not registered`)
  const handler = command.options["handler"] as (args: string, ctx: unknown) => Promise<void>
  await handler(args, ctx)
}

describe("registerTaskCommands", () => {
  it("#given the component registers commands #when inspecting the api #then /tasks and /task-kill exist", () => {
    // given
    const pi = new FakeExtensionAPI()
    registerTaskCommands(pi, fakeManager([]))

    // when
    const names = pi.commands.map((entry) => entry.name).sort()

    // then
    expect(names).toEqual(["task-kill", "tasks"])
  })

  it("#given tasks in two sessions #when /tasks runs #then only the current session's rows print", async () => {
    // given
    const mine = record({ task_id: "st_mine", status: "running" })
    const other = record({ task_id: "st_other", status: "running", parent_session_id: "session-b", root_session_id: "session-b" })
    const pi = new FakeExtensionAPI()
    registerTaskCommands(pi, fakeManager([mine, other]))
    const { ctx, ui } = commandCtx("session-a", "tui")

    // when
    await invoke(pi, "tasks", "", ctx)

    // then
    const printed = ui.notifications.join("\n")
    expect(printed).toContain("st_mine")
    expect(printed).not.toContain("st_other")
  })

  it("#given tasks in two sessions #when /tasks --all runs #then every session's rows print", async () => {
    // given
    const mine = record({ task_id: "st_mine", status: "running" })
    const other = record({ task_id: "st_other", status: "running", parent_session_id: "session-b", root_session_id: "session-b" })
    const pi = new FakeExtensionAPI()
    registerTaskCommands(pi, fakeManager([mine, other]))
    const { ctx, ui } = commandCtx("session-a", "tui")

    // when
    await invoke(pi, "tasks", "--all", ctx)

    // then
    const printed = ui.notifications.join("\n")
    expect(printed).toContain("st_mine")
    expect(printed).toContain("st_other")
  })

  it("#given a cancellable task #when /task-kill selects it and confirms #then cancelTask runs for that id", async () => {
    // given
    const running = record({ task_id: "st_kill", status: "running" })
    const manager = fakeManager([running])
    const pi = new FakeExtensionAPI()
    registerTaskCommands(pi, manager)
    const { ctx, ui } = commandCtx("session-a", "tui", {
      select: (_title, options) => Promise.resolve(options[0]),
      confirm: () => Promise.resolve(true),
    })

    // when
    await invoke(pi, "task-kill", "", ctx)

    // then the selector was shown and the chosen task cancelled
    expect(ui.selectCalls).toHaveLength(1)
    expect(manager.cancelled).toEqual(["st_kill"])
  })

  it("#given the selector is dismissed #when /task-kill runs #then nothing is cancelled", async () => {
    // given a user who escapes the selector (undefined)
    const running = record({ task_id: "st_kill", status: "running" })
    const manager = fakeManager([running])
    const pi = new FakeExtensionAPI()
    registerTaskCommands(pi, manager)
    const { ctx } = commandCtx("session-a", "tui", { select: () => Promise.resolve(undefined) })

    // when
    await invoke(pi, "task-kill", "", ctx)

    // then
    expect(manager.cancelled).toEqual([])
  })

  it("#given no cancellable tasks #when /task-kill runs #then it notifies and never opens the selector", async () => {
    // given only a terminal task
    const done = record({ task_id: "st_done", status: "completed" })
    const manager = fakeManager([done])
    const pi = new FakeExtensionAPI()
    registerTaskCommands(pi, manager)
    const { ctx, ui } = commandCtx("session-a", "tui")

    // when
    await invoke(pi, "task-kill", "", ctx)

    // then
    expect(ui.selectCalls).toHaveLength(0)
    expect(manager.cancelled).toEqual([])
    expect(ui.notifications.join("\n")).toContain("No cancellable")
  })
})
