import { describe, expect, test } from "bun:test"

import type { TaskRecord } from "../state"
import type { PersistedTaskEvent } from "../store"
import { createCompletionNotifier } from "./notifier"
import type { ParentNotifier, ParentNotifierMessage } from "./types"

// The adapter under contract here is omo-senpi's ParentNotifier: it enqueues into the shared
// idle-injection coordinator, so a returning enqueue only means QUEUED. A batch window dropped by a
// /reload (or any failed flush) reports back through recordDeliveryFailure, and the bookkeeping that
// receipt performs is the ONLY thing standing between "the parent gets its completion after the
// reload" and "the parent never learns its background task finished".
function baseRecord(overrides: Partial<TaskRecord> = {}): TaskRecord {
  return {
    task_id: "st_dropped",
    name: "background-child",
    parent_session_id: "session-a",
    root_session_id: "session-a",
    depth: 1,
    execution_mode: "process",
    model: "gpt-5.2",
    status: "completed",
    residency_state: "persisted_only",
    created_at: "2026-08-04T01:00:00.000Z",
    updated_at: "2026-08-04T01:00:03.000Z",
    final_response: "done",
    notify_on_terminal: true,
    notification: { run_epoch: 0, notified_epoch: -1 },
    ...overrides,
  }
}

function fakeStore(seed: readonly TaskRecord[]) {
  const records = new Map(seed.map((record) => [record.task_id, record]))
  const events: Array<{ readonly taskId: string; readonly event: PersistedTaskEvent }> = []
  const store = {
    load: (taskId: string): TaskRecord | null => records.get(taskId) ?? null,
    list: () => ({ records: [...records.values()], diagnostics: [] }),
    replace: (record: TaskRecord): void => {
      records.set(record.task_id, record)
    },
    mutate: (taskId: string, mutation: (record: TaskRecord) => TaskRecord): TaskRecord | null => {
      const fresh = records.get(taskId)
      if (fresh === undefined) return null
      const next = mutation(fresh)
      if (next !== fresh) records.set(taskId, next)
      return next
    },
    appendEvent: (taskId: string, event: PersistedTaskEvent): string => {
      events.push({ taskId, event })
      return `${taskId}.jsonl`
    },
  }
  return { store, records, events }
}

function capturingNotifier(): { notifier: ParentNotifier; calls: ParentNotifierMessage[] } {
  const calls: ParentNotifierMessage[] = []
  return { notifier: { enqueue: (message) => calls.push(message) }, calls }
}

function fakeScheduler() {
  const calls: Array<{ readonly run: () => void; readonly delayMs: number }> = []
  const schedule = (run: () => void, delayMs: number): (() => void) => {
    calls.push({ run, delayMs })
    return () => undefined
  }
  return { calls, schedule }
}

describe("createCompletionNotifier - async delivery failure receipts", () => {
  test("#given a completion the adapter accepted and never delivered #when the failure receipt lands #then the epoch rolls back and the next session_start reconcile redelivers", () => {
    // given a delivered-and-persisted completion (the batching adapter reported success on enqueue)
    const { store, records, events } = fakeStore([baseRecord()])
    const parent = capturingNotifier()
    const completion = createCompletionNotifier({ notifier: parent.notifier, store })
    completion.notifyTerminal({ record: baseRecord(), parentState: { kind: "idle" }, runInBackground: true })
    expect(parent.calls).toHaveLength(1)
    expect(records.get("st_dropped")?.notification.notified_epoch).toBe(0)
    // reconcile is a no-op while the record looks notified
    completion.reconcileUnnotifiedNotifications({ sessionId: "session-a", parentState: { kind: "idle" } })
    expect(parent.calls).toHaveLength(1)

    // when the coordinator retires on session_shutdown and hands the queued injection back
    completion.recordDeliveryFailure({ taskIds: ["st_dropped"], error: new Error("coordinator retired") })

    // then the record owes a notification again, with an audit trail
    expect(records.get("st_dropped")?.notification.notified_epoch).toBe(-1)
    expect(records.get("st_dropped")?.notification.notification_failed_epoch).toBe(0)
    expect(events.map((entry) => entry.event.type)).toEqual(["notification_failed"])

    // and the post-reload session_start redelivers it instead of skipping it forever
    completion.reconcileUnnotifiedNotifications({ sessionId: "session-a", parentState: { kind: "idle" } })
    expect(parent.calls).toHaveLength(2)
    expect(parent.calls[1]?.details.map((detail) => detail.task_id)).toEqual(["st_dropped"])
  })

  test("#given a failure receipt #when it is recorded #then the in-process retry ladder is re-entered", () => {
    // given the parent session is still the one that owns the record (the retry's owner fence)
    const { store } = fakeStore([baseRecord()])
    const parent = capturingNotifier()
    const scheduler = fakeScheduler()
    const completion = createCompletionNotifier({
      notifier: parent.notifier,
      store,
      schedule: scheduler.schedule,
      getCurrentSessionId: () => "session-a",
    })
    completion.notifyTerminal({ record: baseRecord(), parentState: { kind: "idle" }, runInBackground: true })

    // when
    completion.recordDeliveryFailure({ taskIds: ["st_dropped"], error: new Error("coordinator retired") })

    // then a retry is scheduled, and running it redelivers the completion
    expect(scheduler.calls).toHaveLength(1)
    scheduler.calls[0]?.run()
    expect(parent.calls).toHaveLength(2)
  })

  test("#given a stale receipt for a task that already started a new run #when it is recorded #then the epoch bookkeeping is untouched", () => {
    // given a record that went back to running (a later run owns the notification now)
    const { store, records, events } = fakeStore([
      baseRecord({ status: "running", notification: { run_epoch: 1, notified_epoch: 1 } }),
    ])
    const parent = capturingNotifier()
    const completion = createCompletionNotifier({ notifier: parent.notifier, store })

    // when
    completion.recordDeliveryFailure({ taskIds: ["st_dropped"], error: new Error("coordinator retired") })

    // then
    expect(records.get("st_dropped")?.notification).toEqual({ run_epoch: 1, notified_epoch: 1 })
    expect(events).toHaveLength(0)
    expect(parent.calls).toHaveLength(0)
  })

  test("#given a receipt for a cancelled task #when it is recorded #then nothing is stamped (cancel never notifies)", () => {
    // given: parent-initiated cancels return in the tool result, so they must never push a completion
    const { store, records, events } = fakeStore([
      baseRecord({ status: "cancelled", notification: { run_epoch: 0, notified_epoch: 0 } }),
    ])
    const parent = capturingNotifier()
    const completion = createCompletionNotifier({ notifier: parent.notifier, store })

    // when
    completion.recordDeliveryFailure({ taskIds: ["st_dropped"], error: new Error("coordinator retired") })

    // then
    expect(records.get("st_dropped")?.notification).toEqual({ run_epoch: 0, notified_epoch: 0 })
    expect(events).toHaveLength(0)
  })

  test("#given a receipt for a record that no longer exists #when it is recorded #then it is ignored", () => {
    // given a record already reaped by ttl cleanup between enqueue and the failed flush
    const { store, events } = fakeStore([])
    const parent = capturingNotifier()
    const completion = createCompletionNotifier({ notifier: parent.notifier, store })

    // when / then
    expect(() => completion.recordDeliveryFailure({ taskIds: ["st_gone"], error: new Error("coordinator retired") })).not.toThrow()
    expect(events).toHaveLength(0)
    expect(parent.calls).toHaveLength(0)
  })
})
