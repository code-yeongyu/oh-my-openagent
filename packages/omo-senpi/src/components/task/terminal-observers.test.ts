import { describe, expect, test } from "bun:test"

import type { TaskRecord } from "@oh-my-opencode/senpi-task"

import {
  createTaskTerminalObservers,
  sharedTaskTerminalObservers,
  TASK_TERMINAL_OBSERVERS_KEY,
  type TaskTerminalEdge,
} from "./terminal-observers"

function record(overrides: Partial<TaskRecord> = {}): TaskRecord {
  return {
    task_id: "tsk_1",
    status: "completed",
    residency_state: "resident",
    parent_session_id: "parent-1",
    root_session_id: "parent-1",
    depth: 0,
    execution_mode: "in-process",
    model: "anthropic/claude-opus-5",
    notify_on_terminal: false,
    created_at: "2026-08-21T00:00:00.000Z",
    updated_at: "2026-08-21T00:01:00.000Z",
    notification: { run_epoch: 0, notified_epoch: -1 },
    ...overrides,
  }
}

function edge(overrides: Partial<TaskTerminalEdge> = {}): TaskTerminalEdge {
  return { record: record(), previousStatus: "running", ...overrides }
}

describe("task terminal observer ledger", () => {
  test("#given a registered observer #when a terminal edge is notified #then it receives the edge exactly once", () => {
    // given
    const observers = createTaskTerminalObservers()
    const seen: TaskTerminalEdge[] = []
    observers.subscribe((received) => seen.push(received))

    // when
    observers.notify(edge())

    // then
    expect(seen).toHaveLength(1)
    expect(seen[0]?.record.task_id).toBe("tsk_1")
    expect(seen[0]?.previousStatus).toBe("running")
  })

  test("#given an unsubscribed observer #when a terminal edge is notified #then it receives nothing", () => {
    // given
    const observers = createTaskTerminalObservers()
    let calls = 0
    const unsubscribe = observers.subscribe(() => {
      calls += 1
    })

    // when
    unsubscribe()
    observers.notify(edge())

    // then
    expect(calls).toBe(0)
  })

  test("#given an observer that throws #when a terminal edge is notified #then notify still returns and later observers run", () => {
    // given
    const observers = createTaskTerminalObservers()
    const failures: unknown[] = []
    const surviving: TaskTerminalEdge[] = []
    const isolated = createTaskTerminalObservers((error) => failures.push(error))
    isolated.subscribe(() => {
      throw new Error("observer exploded")
    })
    isolated.subscribe((received) => surviving.push(received))
    observers.subscribe(() => {
      throw new Error("unreported")
    })

    // when
    isolated.notify(edge())
    observers.notify(edge())

    // then
    expect(surviving).toHaveLength(1)
    expect(failures).toHaveLength(1)
    expect(failures[0]).toBeInstanceOf(Error)
  })

  test("#given a ledger already on globalThis #when sharedTaskTerminalObservers is called again #then the same ledger is reused", () => {
    // given
    const registry = globalThis as unknown as Record<symbol, unknown>
    const previous = registry[TASK_TERMINAL_OBSERVERS_KEY]
    delete registry[TASK_TERMINAL_OBSERVERS_KEY]

    // when
    const first = sharedTaskTerminalObservers()
    const second = sharedTaskTerminalObservers()

    // then
    try {
      const seen: TaskTerminalEdge[] = []
      const unsubscribe = first.subscribe((received) => seen.push(received))
      second.notify(edge())
      unsubscribe()
      expect(seen).toHaveLength(1)
    } finally {
      if (previous === undefined) delete registry[TASK_TERMINAL_OBSERVERS_KEY]
      else registry[TASK_TERMINAL_OBSERVERS_KEY] = previous
    }
  })

  test("#given a foreign value squatting the ledger slot #when sharedTaskTerminalObservers is called #then a fresh ledger replaces it", () => {
    // given
    const registry = globalThis as unknown as Record<symbol, unknown>
    const previous = registry[TASK_TERMINAL_OBSERVERS_KEY]
    registry[TASK_TERMINAL_OBSERVERS_KEY] = { notAnObserverLedger: true }

    // when
    const observers = sharedTaskTerminalObservers()

    // then
    try {
      const seen: TaskTerminalEdge[] = []
      const unsubscribe = observers.subscribe((received) => seen.push(received))
      observers.notify(edge())
      unsubscribe()
      expect(seen).toHaveLength(1)
    } finally {
      if (previous === undefined) delete registry[TASK_TERMINAL_OBSERVERS_KEY]
      else registry[TASK_TERMINAL_OBSERVERS_KEY] = previous
    }
  })
})
