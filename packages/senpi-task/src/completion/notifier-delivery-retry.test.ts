import { describe, expect, test } from "bun:test"

import type { TaskRecord } from "../state"
import type { PersistedTaskEvent } from "../store"
import { createCompletionNotifier } from "./notifier"
import type { ParentNotifier, ParentNotifierMessage } from "./types"

function terminalRecord(): TaskRecord {
  return {
    task_id: "st_delivery_retry",
    name: "delivery-retry",
    parent_session_id: "session-a",
    root_session_id: "session-a",
    depth: 1,
    execution_mode: "in-process",
    model: "gpt-5.2",
    status: "completed",
    residency_state: "resident",
    created_at: "2026-07-12T01:00:00.000Z",
    updated_at: "2026-07-12T01:00:03.000Z",
    final_response: "done",
    notify_on_terminal: false,
    notification: { run_epoch: 0, notified_epoch: -1 },
  }
}

function completionStore(record: TaskRecord) {
  const records = new Map([[record.task_id, record]])
  return {
    records,
    store: {
      load: (taskId: string): TaskRecord | null => records.get(taskId) ?? null,
      list: () => ({ records: [...records.values()], diagnostics: [] }),
      replace: (next: TaskRecord): void => {
        records.set(next.task_id, next)
      },
      mutate: (taskId: string, mutation: (current: TaskRecord) => TaskRecord): TaskRecord | null => {
        const current = records.get(taskId)
        if (current === undefined) return null
        const next = mutation(current)
        records.set(taskId, next)
        return next
      },
      appendEvent: (taskId: string, _event: PersistedTaskEvent): string => `${taskId}.jsonl`,
    },
  }
}

function deferredDelivery(): {
  readonly promise: Promise<void>
  readonly resolve: () => void
  readonly reject: (error: unknown) => void
} {
  let resolvePromise: (() => void) | undefined
  let rejectPromise: ((error: unknown) => void) | undefined
  const promise = new Promise<void>((resolve, reject) => {
    resolvePromise = resolve
    rejectPromise = reject
  })
  return {
    promise,
    resolve: () => resolvePromise?.(),
    reject: (error) => rejectPromise?.(error),
  }
}

describe("createCompletionNotifier delivery retry", () => {
  test("#given an asynchronous parent rejection w2notif #when delivery settles #then the epoch remains pending and the bounded retry persists it once", async () => {
    // given
    const record = terminalRecord()
    const { store, records } = completionStore(record)
    const firstDelivery = deferredDelivery()
    const calls: ParentNotifierMessage[] = []
    const notifier: ParentNotifier = {
      enqueue: (message) => {
        calls.push(message)
        return calls.length === 1 ? firstDelivery.promise : Promise.resolve()
      },
    }
    const scheduled: (() => void)[] = []
    const completion = createCompletionNotifier({
      store,
      notifier,
      schedule: (run) => {
        scheduled.push(run)
        return () => undefined
      },
      getCurrentSessionId: () => "session-a",
      getParentState: () => ({ kind: "idle" }),
    })

    // when the same terminal edge is observed twice before acknowledgement
    const first = completion.notifyTerminal({ record, parentState: { kind: "idle" }, runInBackground: true })
    const duplicate = completion.notifyTerminal({ record, parentState: { kind: "idle" }, runInBackground: true })

    // then one in-flight delivery owns the epoch and it is not yet persisted
    expect(first).toEqual({ kind: "delivered", decision: "wake" })
    expect(duplicate).toEqual({ kind: "delivered", decision: "wake" })
    expect(calls).toHaveLength(1)
    expect(records.get(record.task_id)?.notification.notified_epoch).toBe(-1)

    // when the delivery rejects and the scheduled retry succeeds
    firstDelivery.reject(new Error("parent rejected"))
    await Promise.resolve()
    expect(records.get(record.task_id)?.notification.notification_failed_epoch).toBe(0)
    expect(scheduled).toHaveLength(1)
    scheduled[0]?.()
    await Promise.resolve()

    // then the successful acknowledgement persists exactly once
    expect(calls).toHaveLength(2)
    expect(records.get(record.task_id)?.notification.notified_epoch).toBe(0)
  })

  test("#given reconcile starts a replacement receipt before an armed retry #when the timer fires #then the live receipt keeps sole delivery ownership", async () => {
    // given
    const record = terminalRecord()
    const { store } = completionStore(record)
    const firstDelivery = deferredDelivery()
    const replacementDelivery = deferredDelivery()
    const calls: ParentNotifierMessage[] = []
    const notifier: ParentNotifier = {
      enqueue: (message) => {
        calls.push(message)
        if (calls.length === 1) return firstDelivery.promise
        if (calls.length === 2) return replacementDelivery.promise
        return Promise.resolve()
      },
    }
    const scheduled: (() => void)[] = []
    const completion = createCompletionNotifier({
      store,
      notifier,
      schedule: (run) => {
        scheduled.push(run)
        return () => undefined
      },
      getCurrentSessionId: () => "session-a",
      getParentState: () => ({ kind: "idle" }),
    })
    completion.notifyTerminal({ record, parentState: { kind: "idle" }, runInBackground: true })
    firstDelivery.reject(new Error("parent rejected"))
    await Promise.resolve()

    // when reconciliation owns the replacement receipt before the armed timer fires
    completion.reconcileFailedNotifications({ sessionId: "session-a", parentState: { kind: "idle" } })
    scheduled[0]?.()

    // then the timer does not enqueue a third delivery for the same task epoch
    expect(calls).toHaveLength(2)
    replacementDelivery.resolve()
    await Promise.resolve()
  })
})
