import { describe, expect, test } from "bun:test"

import type { TaskRecord } from "../state"
import type { PersistedTaskEvent } from "../store"
import { createCompletionNotifier } from "./notifier"
import type { ParentNotifier, ParentNotifierMessage, ParentState } from "./types"

function baseRecord(overrides: Partial<TaskRecord> = {}): TaskRecord {
  return {
    task_id: "st_retry",
    name: "retry-me",
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
    notification: { run_epoch: 0, notified_epoch: -1 },
    ...overrides,
  }
}

function failedRecord(overrides: Partial<TaskRecord> = {}): TaskRecord {
  return baseRecord({ notification: { run_epoch: 0, notified_epoch: -1, notification_failed_epoch: 0 }, ...overrides })
}

function fakeStore(seed: readonly TaskRecord[]) {
  const records = new Map(seed.map((record) => [record.task_id, record]))
  const replaced: TaskRecord[] = []
  const store = {
    load: (taskId: string): TaskRecord | null => records.get(taskId) ?? null,
    list: () => ({ records: [...records.values()], diagnostics: [] }),
    replace: (record: TaskRecord): void => {
      records.set(record.task_id, record)
      replaced.push(record)
    },
    appendEvent: (taskId: string, _event: PersistedTaskEvent): string => `${taskId}.jsonl`,
  }
  return { store, records, replaced }
}

function scriptedNotifier(failuresBeforeSuccess: number) {
  const calls: ParentNotifierMessage[] = []
  let remainingFailures = failuresBeforeSuccess
  const notifier: ParentNotifier = {
    enqueue: (message) => {
      if (remainingFailures > 0) {
        remainingFailures -= 1
        throw new Error("parent unavailable")
      }
      calls.push(message)
    },
  }
  return { notifier, calls }
}

type ScheduledCall = { readonly run: () => void; readonly delayMs: number }

function fakeScheduler() {
  const calls: ScheduledCall[] = []
  const schedule = (run: () => void, delayMs: number): (() => void) => {
    calls.push({ run, delayMs })
    return () => undefined
  }
  const run = (index: number): void => {
    const call = calls[index]
    if (call === undefined) throw new RangeError(`missing scheduled call ${index}`)
    call.run()
  }
  return { calls, run, schedule }
}

type NotifierFixtureDeps = {
  readonly store: ReturnType<typeof fakeStore>["store"]
  readonly notifier: ParentNotifier
  readonly scheduler: ReturnType<typeof fakeScheduler>
  readonly getCurrentSessionId?: () => string | undefined
  readonly getParentState?: () => ParentState
}

function notifierDeps(input: NotifierFixtureDeps) {
  return {
    store: input.store,
    notifier: input.notifier,
    schedule: input.scheduler.schedule,
    getCurrentSessionId: input.getCurrentSessionId ?? (() => "session-a"),
    getParentState: input.getParentState ?? (() => ({ kind: "idle" as const })),
  }
}

describe("createCompletionNotifier scheduled retries", () => {
  test("#given two immediate failures w2notif #when the first timer fires #then delivery persists exactly once", () => {
    // given
    const record = baseRecord()
    const { store, replaced } = fakeStore([record])
    const parent = scriptedNotifier(2)
    const scheduler = fakeScheduler()
    const completion = createCompletionNotifier(notifierDeps({ store, notifier: parent.notifier, scheduler }))

    // when
    expect(completion.notifyTerminal({ record, parentState: { kind: "idle" }, runInBackground: true })).toEqual({ kind: "failed" })
    scheduler.run(0)

    // then
    expect(scheduler.calls[0]?.delayMs).toBeGreaterThanOrEqual(500)
    expect(scheduler.calls[0]?.delayMs).toBeLessThan(700)
    expect(parent.calls).toHaveLength(1)
    expect(replaced.filter((item) => item.notification.notified_epoch === 0)).toHaveLength(1)
  })

  test("#given a failed epoch w2notif #when revive advances the epoch before retry #then stale delivery drops", () => {
    // given
    const record = baseRecord()
    const { store, records } = fakeStore([record])
    const parent = scriptedNotifier(2)
    const scheduler = fakeScheduler()
    const completion = createCompletionNotifier(notifierDeps({ store, notifier: parent.notifier, scheduler }))
    completion.notifyTerminal({ record, parentState: { kind: "idle" }, runInBackground: true })
    const revived = baseRecord({ notification: { run_epoch: 1, notified_epoch: -1 } })
    records.set(record.task_id, revived)

    // when
    scheduler.run(0)
    const nextEpoch = completion.notifyTerminal({ record: revived, parentState: { kind: "idle" }, runInBackground: true })

    // then
    expect(parent.calls).toHaveLength(1)
    expect(nextEpoch).toEqual({ kind: "delivered", decision: "wake" })
    expect(records.get(record.task_id)?.notification.notified_epoch).toBe(1)
  })

  test("#given a pending retry w2notif #when the buffered entry flushes first #then the timer skips notified work", () => {
    // given
    const record = baseRecord()
    const { store } = fakeStore([record])
    const parent = scriptedNotifier(2)
    const scheduler = fakeScheduler()
    const completion = createCompletionNotifier(notifierDeps({ store, notifier: parent.notifier, scheduler }))
    completion.notifyTerminal({ record, parentState: { kind: "idle" }, runInBackground: true })
    completion.notifyTerminal({ record, parentState: { kind: "compacting" }, runInBackground: true })
    completion.flushBuffered({ sessionId: "session-a", replaced: false })

    // when
    scheduler.run(0)

    // then
    expect(parent.calls).toHaveLength(1)
  })

  test("#given persistent enqueue failures w2notif #when eight timers exhaust #then no ninth timer is scheduled", () => {
    // given
    const record = baseRecord()
    const { store, records } = fakeStore([record])
    const parent = scriptedNotifier(Number.POSITIVE_INFINITY)
    const scheduler = fakeScheduler()
    const completion = createCompletionNotifier(notifierDeps({ store, notifier: parent.notifier, scheduler }))
    completion.notifyTerminal({ record, parentState: { kind: "idle" }, runInBackground: true })

    // when
    for (let index = 0; index < 8; index += 1) scheduler.run(index)
    completion.reconcileFailedNotifications({ sessionId: "session-a", parentState: { kind: "idle" } })

    // then
    expect(scheduler.calls).toHaveLength(8)
    expect(records.get(record.task_id)?.notification.notification_failed_epoch).toBe(0)
  })

  test("#given failed records from mixed sessions w2notif #when reconciled twice #then only eligible work delivers once", () => {
    // given
    const eligible = failedRecord({ task_id: "st_eligible" })
    const alreadyNotified = failedRecord({ task_id: "st_notified", notification: { run_epoch: 0, notified_epoch: 0, notification_failed_epoch: 0 } })
    const otherSession = failedRecord({ task_id: "st_other", parent_session_id: "session-b" })
    const nonNotifying = failedRecord({ task_id: "st_cancelled", status: "cancelled", final_response: undefined })
    const notFailed = baseRecord({ task_id: "st_clean" })
    const { store } = fakeStore([eligible, alreadyNotified, otherSession, nonNotifying, notFailed])
    const parent = scriptedNotifier(0)
    const scheduler = fakeScheduler()
    const completion = createCompletionNotifier(notifierDeps({ store, notifier: parent.notifier, scheduler }))

    // when
    completion.reconcileFailedNotifications({ sessionId: "session-a", parentState: { kind: "idle" } })
    completion.reconcileFailedNotifications({ sessionId: "session-a", parentState: { kind: "idle" } })

    // then
    expect(parent.calls).toHaveLength(1)
    expect(parent.calls[0]?.details.map((detail) => detail.task_id)).toEqual(["st_eligible"])
  })

  test("#given a failed record w2notif #when reconciliation sees compaction #then it buffers normally", () => {
    // given
    const record = failedRecord()
    const { store } = fakeStore([record])
    const parent = scriptedNotifier(0)
    const scheduler = fakeScheduler()
    const completion = createCompletionNotifier(notifierDeps({ store, notifier: parent.notifier, scheduler }))

    // when
    completion.reconcileFailedNotifications({ sessionId: "session-a", parentState: { kind: "compacting" } })

    // then
    expect(parent.calls).toHaveLength(0)
    expect(completion.bufferedCount("session-a")).toBe(1)
  })

  test("#given retries keep failing w2notif #when timers reschedule #then delays follow the capped ladder", () => {
    // given
    const record = baseRecord()
    const { store } = fakeStore([record])
    const parent = scriptedNotifier(Number.POSITIVE_INFINITY)
    const scheduler = fakeScheduler()
    const completion = createCompletionNotifier(notifierDeps({ store, notifier: parent.notifier, scheduler }))
    completion.notifyTerminal({ record, parentState: { kind: "idle" }, runInBackground: true })

    // when
    for (let index = 0; index < 8; index += 1) scheduler.run(index)

    // then
    const bases = [500, 1_000, 2_000, 4_000, 8_000, 16_000, 30_000, 30_000]
    expect(scheduler.calls.every((call, index) => {
      const base = bases[index]
      return base !== undefined && call.delayMs >= base && call.delayMs <= Math.min(30_000, base + 199)
    })).toBe(true)
  })

  test("#given a retry dropped for another session w2notif #when its session reconciles #then backoff restarts at the base delay", () => {
    // given
    const record = baseRecord()
    const { store } = fakeStore([record])
    const parent = scriptedNotifier(Number.POSITIVE_INFINITY)
    const scheduler = fakeScheduler()
    let currentSessionId = "session-b"
    const completion = createCompletionNotifier(notifierDeps({
      store,
      notifier: parent.notifier,
      scheduler,
      getCurrentSessionId: () => currentSessionId,
    }))
    completion.notifyTerminal({ record, parentState: { kind: "idle" }, runInBackground: true })
    scheduler.run(0)

    // when
    currentSessionId = "session-a"
    completion.reconcileFailedNotifications({ sessionId: "session-a", parentState: { kind: "idle" } })

    // then
    expect(scheduler.calls[1]?.delayMs).toBeGreaterThanOrEqual(500)
    expect(scheduler.calls[1]?.delayMs).toBeLessThan(700)
  })

  test("#given session A owns a failed retry w2notif #when session B is current #then retry drops until A reconciles", () => {
    // given
    const record = baseRecord()
    const { store, records } = fakeStore([record])
    const parent = scriptedNotifier(2)
    const scheduler = fakeScheduler()
    let currentSessionId = "session-b"
    const completion = createCompletionNotifier(notifierDeps({
      store,
      notifier: parent.notifier,
      scheduler,
      getCurrentSessionId: () => currentSessionId,
    }))
    completion.notifyTerminal({ record, parentState: { kind: "idle" }, runInBackground: true })

    // when
    scheduler.run(0)

    // then
    expect(parent.calls).toHaveLength(0)
    expect(completion.bufferedCount("session-a")).toBe(0)
    expect(records.get(record.task_id)?.notification.notification_failed_epoch).toBe(0)

    // when
    currentSessionId = "session-a"
    completion.reconcileFailedNotifications({ sessionId: "session-a", parentState: { kind: "idle" } })

    // then
    expect(parent.calls).toHaveLength(1)
    expect(records.get(record.task_id)?.notification.notified_epoch).toBe(0)
  })
})
