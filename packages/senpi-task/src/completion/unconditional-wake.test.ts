import { describe, expect, test } from "bun:test"

import { createCompletionNotifier } from "./notifier"
import { routeCompletion } from "./routing"
import type { ParentNotifier, ParentNotifierMessage, ParentState } from "./types"
import type { TaskRecord } from "../state"
import type { PersistedTaskEvent } from "../store"

// Product-owner invariant: a completed background child's notification MUST unconditionally steer into
// the parent's running turn at the next tool-call boundary, and multiple ready notifications batch into
// ONE injection. No config may suppress, delay, or split it - the deliver_as knob no longer exists.

function baseRecord(overrides: Partial<TaskRecord> = {}): TaskRecord {
  return {
    task_id: "st_wake",
    name: "wake-me",
    parent_session_id: "parent-session",
    root_session_id: "root-session",
    depth: 1,
    execution_mode: "in-process",
    model: "gpt-5.2",
    status: "completed",
    residency_state: "resident",
    created_at: "2026-07-06T01:00:00.000Z",
    updated_at: "2026-07-06T01:00:03.000Z",
    final_response: "done",
    notification: { run_epoch: 0, notified_epoch: -1 },
    ...overrides,
  }
}

function fakeStore(record: TaskRecord) {
  const records = new Map<string, TaskRecord>([[record.task_id, record]])
  return {
    load: (taskId: string): TaskRecord | null => records.get(taskId) ?? null,
    replace: (next: TaskRecord): void => {
      records.set(next.task_id, next)
    },
    appendEvent: (_taskId: string, _event: PersistedTaskEvent): string => "log.jsonl",
    list: () => ({ records: [...records.values()], diagnostics: [] }),
  }
}

function fakeNotifier(): { notifier: ParentNotifier; calls: ParentNotifierMessage[] } {
  const calls: ParentNotifierMessage[] = []
  return { notifier: { enqueue: (message) => calls.push(message) }, calls }
}

describe("unconditional wake", () => {
  test("#given an idle parent #when a background child completes #then it always wakes with triggerTurn", () => {
    // given an idle parent (the state the old wake_idle_parent:false knob used to silence)
    const state: ParentState = { kind: "idle" }

    // when routed
    const decision = routeCompletion(state)

    // then it wakes, never queues silently
    expect(decision).toEqual({ kind: "wake" })
  })

  test("#given an idle parent #when notified end to end #then a triggerTurn message is enqueued", () => {
    // given
    const record = baseRecord()
    const { notifier, calls } = fakeNotifier()
    const completion = createCompletionNotifier({ notifier, store: fakeStore(record) })

    // when
    const result = completion.notifyTerminal({ record, parentState: { kind: "idle" }, runInBackground: true })

    // then the completion injects on the parent's next turn
    expect(result).toEqual({ kind: "delivered", decision: "wake" })
    expect(calls).toHaveLength(1)
    expect(calls[0]?.triggerTurn).toBe(true)
  })

  test("#given a streaming parent #when a background child completes #then delivery carries triggerTurn for the batched steer", () => {
    // given
    const record = baseRecord()
    const { notifier, calls } = fakeNotifier()
    const completion = createCompletionNotifier({ notifier, store: fakeStore(record) })

    // when
    const result = completion.notifyTerminal({ record, parentState: { kind: "streaming" }, runInBackground: true })

    // then a streaming completion also guarantees a turn; the adapter steers the batched injection
    expect(result).toEqual({ kind: "delivered", decision: "deliver_streaming" })
    expect(calls[0]?.triggerTurn).toBe(true)
  })
})
