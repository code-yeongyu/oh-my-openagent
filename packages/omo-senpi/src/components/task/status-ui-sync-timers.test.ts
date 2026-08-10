import { describe, expect, test } from "bun:test"

import type { ListedTask, TaskRecord } from "@oh-my-opencode/senpi-task"

import { createTaskStatusUi, type StatusUiManager, type StatusUiTimers } from "./status-ui"

const RECORD: TaskRecord = {
  task_id: "st_sync_timer",
  parent_session_id: "session-a",
  root_session_id: "session-a",
  depth: 0,
  execution_mode: "in-process",
  model: "anthropic/claude-sonnet-4-6",
  residency_state: "resident",
  status: "running",
  created_at: "2026-08-10T00:00:00.000Z",
  updated_at: "2026-08-10T00:00:01.000Z",
  notification: { run_epoch: 0, notified_epoch: -1 },
  notify_on_terminal: false,
}

describe("createTaskStatusUi synchronous timer safety", () => {
  test("#given a timer callback fires before its handle returns #when a live row renders #then it does not retain or dereference an uninitialized handle", () => {
    const listed: ListedTask = { record: RECORD }
    const manager: StatusUiManager = {
      list: () => [listed],
      wasBackground: () => true,
    }
    let cleared = 0
    const timers: StatusUiTimers = {
      set: (callback) => {
        callback()
        return 1
      },
      clear: () => {
        cleared += 1
      },
    }
    const widgetCalls: unknown[] = []
    const statusUi = createTaskStatusUi({
      manager,
      runtime: {
        ui: () => ({
          notify: () => undefined,
          setStatus: () => undefined,
          setWidget: (_key, content) => widgetCalls.push(content),
          select: () => Promise.resolve(undefined),
          confirm: () => Promise.resolve(false),
        }),
        sessionId: () => "session-a",
        mode: () => "tui",
      },
      timers,
    })

    statusUi.syncNow()
    statusUi.syncNow()

    expect(widgetCalls).toHaveLength(2)
    expect(cleared).toBe(2)
  })
})
