import { describe, expect, test } from "bun:test"

import type { TaskRecord } from "../state"
import type { PersistedTaskEvent } from "../store"
import { createCompletionNotifier } from "./notifier"
import type { ParentNotifier, ParentNotifierMessage } from "./types"

function baseRecord(overrides: Partial<TaskRecord> = {}): TaskRecord {
  return {
    task_id: "st_reconcile",
    name: "reconcile-me",
    parent_session_id: "session-a",
    root_session_id: "session-a",
    depth: 1,
    execution_mode: "in-process",
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

// When `claimOnPersist` is set, the fake injects a concurrent residency/host_pid claim into the
// record at the exact moment a persist lands - modelling a sibling reconcile that claimed the
// child BETWEEN the notifier's earlier read and its epoch bookkeeping.
function fakeStore(seed: readonly TaskRecord[], claimOnPersist?: Partial<TaskRecord>) {
  const records = new Map(seed.map((record) => [record.task_id, record]))
  const mutated: TaskRecord[] = []
  const applyClaim = (taskId: string): void => {
    if (claimOnPersist === undefined) return
    const current = records.get(taskId)
    if (current !== undefined) records.set(taskId, { ...current, ...claimOnPersist })
  }
  const store = {
    load: (taskId: string): TaskRecord | null => records.get(taskId) ?? null,
    list: () => ({ records: [...records.values()], diagnostics: [] }),
    replace: (record: TaskRecord): void => {
      applyClaim(record.task_id)
      records.set(record.task_id, record)
    },
    mutate: (taskId: string, mutation: (record: TaskRecord) => TaskRecord): TaskRecord | null => {
      if (!records.has(taskId)) return null
      applyClaim(taskId)
      const fresh = records.get(taskId)
      if (fresh === undefined) return null
      const next = mutation(fresh)
      if (next !== fresh) {
        records.set(taskId, next)
        mutated.push(next)
      }
      return next
    },
    appendEvent: (taskId: string, _event: PersistedTaskEvent): string => `${taskId}.jsonl`,
  }
  return { store, records, mutated }
}

function capturingNotifier(): { notifier: ParentNotifier; calls: ParentNotifierMessage[] } {
  const calls: ParentNotifierMessage[] = []
  return { notifier: { enqueue: (message) => calls.push(message) }, calls }
}

function failingNotifier() {
  let attempts = 0
  const notifier: ParentNotifier = {
    enqueue: () => {
      attempts += 1
      throw new Error("parent unavailable")
    },
  }
  return { notifier, attempts: () => attempts }
}

function fakeScheduler() {
  const calls: Array<{ readonly run: () => void; readonly delayMs: number }> = []
  const schedule = (run: () => void, delayMs: number): (() => void) => {
    calls.push({ run, delayMs })
    return () => undefined
  }
  return { calls, schedule }
}

describe("createCompletionNotifier - reconcile unnotified terminal completions", () => {
  test("#given a terminal notify_on_terminal record with an unnotified epoch w4notif #when the session reconciles twice #then exactly one notification is delivered", () => {
    // given
    const record = baseRecord()
    const { store, records } = fakeStore([record])
    const parent = capturingNotifier()
    const completion = createCompletionNotifier({ notifier: parent.notifier, store })

    // when
    completion.reconcileUnnotifiedNotifications({ sessionId: "session-a", parentState: { kind: "idle" } })
    completion.reconcileUnnotifiedNotifications({ sessionId: "session-a", parentState: { kind: "idle" } })

    // then
    expect(parent.calls).toHaveLength(1)
    expect(parent.calls[0]?.details.map((detail) => detail.task_id)).toEqual(["st_reconcile"])
    expect(records.get(record.task_id)?.notification.notified_epoch).toBe(0)
  })

  test("#given an already-notified epoch w4notif #when the session reconciles #then the record is skipped", () => {
    // given
    const record = baseRecord({ notification: { run_epoch: 0, notified_epoch: 0 } })
    const { store } = fakeStore([record])
    const parent = capturingNotifier()
    const completion = createCompletionNotifier({ notifier: parent.notifier, store })

    // when
    completion.reconcileUnnotifiedNotifications({ sessionId: "session-a", parentState: { kind: "idle" } })

    // then
    expect(parent.calls).toHaveLength(0)
  })

  test("#given a terminal unnotified record of another session w4notif #when this session reconciles #then the record is skipped", () => {
    // given
    const record = baseRecord({ parent_session_id: "session-b" })
    const { store } = fakeStore([record])
    const parent = capturingNotifier()
    const completion = createCompletionNotifier({ notifier: parent.notifier, store })

    // when
    completion.reconcileUnnotifiedNotifications({ sessionId: "session-a", parentState: { kind: "idle" } })

    // then
    expect(parent.calls).toHaveLength(0)
  })

  test("#given a terminal unnotified record without opt-in or failed delivery w4notif #when the session reconciles #then the record is skipped", () => {
    // given
    const record = baseRecord({ notify_on_terminal: false })
    const { store } = fakeStore([record])
    const parent = capturingNotifier()
    const completion = createCompletionNotifier({ notifier: parent.notifier, store })

    // when
    completion.reconcileUnnotifiedNotifications({ sessionId: "session-a", parentState: { kind: "idle" } })

    // then
    expect(parent.calls).toHaveLength(0)
  })

  test("#given a legacy failed-delivery record without notify_on_terminal w4notif #when the session reconciles #then the in-flight retry is preserved", () => {
    // given
    const record = baseRecord({
      notify_on_terminal: false,
      notification: { run_epoch: 0, notified_epoch: -1, notification_failed_epoch: 0 },
    })
    const { store } = fakeStore([record])
    const parent = capturingNotifier()
    const completion = createCompletionNotifier({ notifier: parent.notifier, store })

    // when
    completion.reconcileUnnotifiedNotifications({ sessionId: "session-a", parentState: { kind: "idle" } })

    // then
    expect(parent.calls).toHaveLength(1)
    expect(parent.calls[0]?.details.map((detail) => detail.task_id)).toEqual(["st_reconcile"])
  })

  test("#given delivery fails during reconcile w4notif #when the enqueue throws #then notification_failed_epoch is recorded and the retry is scheduled", () => {
    // given
    const record = baseRecord()
    const { store, records } = fakeStore([record])
    const parent = failingNotifier()
    const scheduler = fakeScheduler()
    const completion = createCompletionNotifier({ notifier: parent.notifier, store, schedule: scheduler.schedule })

    // when
    completion.reconcileUnnotifiedNotifications({ sessionId: "session-a", parentState: { kind: "idle" } })

    // then
    expect(parent.attempts()).toBe(2)
    expect(records.get(record.task_id)?.notification.notification_failed_epoch).toBe(0)
    expect(records.get(record.task_id)?.notification.notified_epoch).toBe(-1)
    expect(scheduler.calls).toHaveLength(1)
  })

  test("#given a completion buffered behind a transient parent state w4notif #when the session reconciles before the flush #then reconcile skips it and the flush delivers exactly once", () => {
    // given a live in-memory buffer entry for the unnotified terminal epoch
    const record = baseRecord()
    const { store, records } = fakeStore([record])
    const parent = capturingNotifier()
    const completion = createCompletionNotifier({ notifier: parent.notifier, store })
    completion.notifyTerminal({ record, parentState: { kind: "compacting" }, runInBackground: true })
    expect(completion.bufferedCount("session-a")).toBe(1)

    // when the session reconciles while the buffer is still alive
    completion.reconcileUnnotifiedNotifications({ sessionId: "session-a", parentState: { kind: "idle" } })

    // then reconcile leaves delivery to the flush owner of the (task_id, run_epoch) identity
    expect(parent.calls).toHaveLength(0)

    // when the buffer flushes and the session reconciles again
    const flushed = completion.flushBuffered({ sessionId: "session-a", replaced: false })
    completion.reconcileUnnotifiedNotifications({ sessionId: "session-a", parentState: { kind: "idle" } })

    // then exactly one delivery landed total
    expect(flushed).toEqual({ kind: "flushed", count: 1 })
    expect(parent.calls).toHaveLength(1)
    expect(records.get(record.task_id)?.notification.notified_epoch).toBe(0)
  })

  test("#given a residency claim lands between read and notified-epoch persist w4notif #when the epoch is stamped #then the claim survives", () => {
    // given a sibling reconcile claiming residency (resident + host_pid) at persist time
    const record = baseRecord()
    const claim = { residency_state: "resident" as const, host_pid: 4242 }
    const { store, records } = fakeStore([record], claim)
    const parent = capturingNotifier()
    const completion = createCompletionNotifier({ notifier: parent.notifier, store })

    // when
    const result = completion.notifyTerminal({ record, parentState: { kind: "idle" }, runInBackground: true })

    // then the epoch is stamped WITHOUT erasing the concurrent claim (conditional mutate, not replace)
    expect(result).toEqual({ kind: "delivered", decision: "wake" })
    const persisted = records.get(record.task_id)
    expect(persisted?.notification.notified_epoch).toBe(0)
    expect(persisted?.host_pid).toBe(4242)
    expect(persisted?.residency_state).toBe("resident")
  })

  test("#given a residency claim lands before a failed-delivery persist w4notif #when the failure epoch is stamped #then the claim survives", () => {
    // given
    const record = baseRecord()
    const claim = { residency_state: "resident" as const, host_pid: 4242 }
    const { store, records } = fakeStore([record], claim)
    const parent = failingNotifier()
    const scheduler = fakeScheduler()
    const completion = createCompletionNotifier({ notifier: parent.notifier, store, schedule: scheduler.schedule })

    // when
    const result = completion.notifyTerminal({ record, parentState: { kind: "idle" }, runInBackground: true })

    // then
    expect(result).toEqual({ kind: "failed" })
    const persisted = records.get(record.task_id)
    expect(persisted?.notification.notification_failed_epoch).toBe(0)
    expect(persisted?.host_pid).toBe(4242)
    expect(persisted?.residency_state).toBe("resident")
  })
})
