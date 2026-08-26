import { describe, expect, it } from "bun:test"

import type { ListedTask, TaskRecord, TaskStatus } from "@oh-my-opencode/senpi-task"

import type { CapturedUi } from "./runtime-context"
import {
  createTaskStatusUi,
  type StatusUiManager,
  type StatusUiRuntime,
  type StatusUiTimers,
} from "./status-ui"

// The render path runs from bare timer callbacks, so faults must be contained here rather than
// escaping as uncaught exceptions.

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

function listed(records: readonly TaskRecord[]): readonly ListedTask[] {
  return records.map((entry) => ({ record: entry }))
}

function managerOf(records: readonly TaskRecord[]): StatusUiManager {
  return {
    list: (scope) =>
      scope.scope === "all"
        ? listed(records)
        : listed(records.filter((entry) => entry.parent_session_id === scope.session_id)),
  }
}

const BARREL_FAULT = "The @earendil-works/pi-tui barrel was accessed before it was loaded."

function throwingUi(): CapturedUi {
  return {
    notify: () => undefined,
    setStatus: () => undefined,
    setWidget: () => {
      throw new Error(BARREL_FAULT)
    },
    select: () => Promise.resolve(undefined),
    confirm: () => Promise.resolve(false),
  }
}

function throwingUiAfter(firstSuccessfulRenders: number): CapturedUi {
  let renders = 0
  return {
    ...throwingUi(),
    setWidget: () => {
      renders += 1
      if (renders > firstSuccessfulRenders) throw new Error(BARREL_FAULT)
    },
  }
}

function runtimeOf(ui: CapturedUi): StatusUiRuntime {
  return { ui: () => ui, sessionId: () => "session-a", mode: () => "tui" }
}

function manualTimers(): StatusUiTimers & { run(): void; pending(): number } {
  const queued = new Map<number, () => void>()
  let nextHandle = 1
  return {
    set: (callback) => {
      const handle = nextHandle++
      queued.set(handle, callback)
      return handle
    },
    clear: (handle) => {
      if (typeof handle === "number") queued.delete(handle)
    },
    pending: () => queued.size,
    run: () => {
      const callbacks = [...queued.values()]
      queued.clear()
      for (const callback of callbacks) callback()
    },
  }
}

function collectingLogger(): { warn(message: string, meta?: unknown): void; entries: string[] } {
  const entries: string[] = []
  return {
    entries,
    warn: (message) => {
      entries.push(message)
    },
  }
}

describe("createTaskStatusUi render fault containment", () => {
  it("#given a render seam that throws #when syncNow runs #then the fault is contained and logged", () => {
    // given
    const logger = collectingLogger()
    const statusUi = createTaskStatusUi({
      manager: managerOf([record({ task_id: "st_1", status: "running" })]),
      runtime: runtimeOf(throwingUi()),
      logger,
    })

    // when + then
    expect(() => statusUi.syncNow()).not.toThrow()
    expect(logger.entries.length).toBeGreaterThan(0)
  })

  it("#given a render seam that throws #when the debounce timer fires #then the timer callback does not propagate", () => {
    // given
    const timers = manualTimers()
    const logger = collectingLogger()
    const statusUi = createTaskStatusUi({
      manager: managerOf([record({ task_id: "st_1", status: "running" })]),
      runtime: runtimeOf(throwingUi()),
      timers,
      logger,
    })

    // when
    statusUi.scheduleSync()
    expect(timers.pending()).toBe(1)

    // then
    expect(() => timers.run()).not.toThrow()
    expect(logger.entries.length).toBeGreaterThan(0)
  })

  it("#given no logger is wired #when a render seam throws #then the fault is still contained", () => {
    // given
    const timers = manualTimers()
    const statusUi = createTaskStatusUi({
      manager: managerOf([record({ task_id: "st_1", status: "running" })]),
      runtime: runtimeOf(throwingUi()),
      timers,
    })

    // when
    statusUi.scheduleSync()

    // then
    expect(() => timers.run()).not.toThrow()
  })

  it("#given a live refresh render throws #when its timer fires #then the timer callback does not propagate", () => {
    // given
    const timers = manualTimers()
    const logger = collectingLogger()
    const statusUi = createTaskStatusUi({
      manager: {
        ...managerOf([record({ task_id: "st_1", status: "running" })]),
        wasBackground: () => true,
      },
      runtime: runtimeOf(throwingUiAfter(1)),
      timers,
      logger,
    })
    statusUi.syncNow()
    expect(timers.pending()).toBe(1)

    // when + then
    expect(() => timers.run()).not.toThrow()
    expect(logger.entries.length).toBeGreaterThan(0)
    expect(timers.pending()).toBe(0)
  })
})
