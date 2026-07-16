import { describe, expect, test } from "bun:test"

import { createCompletionNotifier } from "./notifier"
import type { ParentNotifier, ParentNotifierMessage, ParentState } from "./types"
import type { TaskRecord } from "../state"
import type { PersistedTaskEvent } from "../store"


function baseRecord(overrides: Partial<TaskRecord> = {}): TaskRecord {
  return {
    task_id: "st_deadbeef",
    name: "summarize-logs",
    parent_session_id: "parent-session",
    root_session_id: "root-session",
    depth: 1,
    execution_mode: "in-process",
    model: "gpt-5.2",
    status: "completed",
    residency_state: "resident",
    created_at: "2026-07-06T01:00:00.000Z",
    updated_at: "2026-07-06T01:00:03.000Z",
    final_response: "the final answer",
    notification: { run_epoch: 0, notified_epoch: -1 },
    ...overrides,
  }
}

type AppendedEvent = { readonly taskId: string; readonly event: PersistedTaskEvent }

function fakeStore(seed: readonly TaskRecord[]) {
  const records = new Map<string, TaskRecord>()
  for (const record of seed) records.set(record.task_id, record)
  const events: AppendedEvent[] = []
  const replaced: TaskRecord[] = []
  const store = {
    load: (taskId: string): TaskRecord | null => records.get(taskId) ?? null,
    list: () => ({ records: [...records.values()], diagnostics: [] }),
    replace: (record: TaskRecord): void => {
      records.set(record.task_id, record)
      replaced.push(record)
    },
    appendEvent: (taskId: string, event: PersistedTaskEvent): string => {
      events.push({ taskId, event })
      return `${taskId}.jsonl`
    },
  }
  return { store, events, replaced, records }
}

type EnqueueCall = ParentNotifierMessage

function fakeNotifier(failuresBeforeSuccess = 0): { notifier: ParentNotifier; calls: EnqueueCall[] } {
  const calls: EnqueueCall[] = []
  let remainingFailures = failuresBeforeSuccess
  const notifier: ParentNotifier = {
    enqueue(message) {
      if (remainingFailures > 0) {
        remainingFailures -= 1
        throw new Error("parent gone")
      }
      calls.push(message)
    },
  }
  return { notifier, calls }
}

describe("createCompletionNotifier - exactly-once epoch contract", () => {
  test("#given double terminal replay #when notified twice #then exactly one delivery", () => {
    // given
    const record = baseRecord()
    const { store, replaced } = fakeStore([record])
    const { notifier, calls } = fakeNotifier()
    const completion = createCompletionNotifier({ notifier, store })

    // when
    const first = completion.notifyTerminal({ record, parentState: { kind: "idle" }, runInBackground: true })
    const second = completion.notifyTerminal({ record, parentState: { kind: "idle" }, runInBackground: true })

    // then
    expect(first).toEqual({ kind: "delivered", decision: "wake" })
    expect(second).toEqual({ kind: "skipped", reason: "already-notified" })
    expect(calls).toHaveLength(1)
    expect(replaced.at(-1)?.notification.notified_epoch).toBe(0)
  })

  test("#given revived task at epoch 1 #when second completion arrives #then it notifies again", () => {
    // given
    const record = baseRecord({ notification: { run_epoch: 1, notified_epoch: 0 } })
    const { store, replaced } = fakeStore([record])
    const { notifier, calls } = fakeNotifier()
    const completion = createCompletionNotifier({ notifier, store })

    // when
    const result = completion.notifyTerminal({ record, parentState: { kind: "idle" }, runInBackground: true })

    // then
    expect(result).toEqual({ kind: "delivered", decision: "wake" })
    expect(calls).toHaveLength(1)
    expect(replaced.at(-1)?.notification.notified_epoch).toBe(1)
  })

  test("#given persisted notified_epoch #when notified after resume #then no re-notify", () => {
    // given
    const record = baseRecord({ notification: { run_epoch: 0, notified_epoch: 0 } })
    const { store } = fakeStore([record])
    const { notifier, calls } = fakeNotifier()
    const completion = createCompletionNotifier({ notifier, store })

    // when
    const result = completion.notifyTerminal({ record, parentState: { kind: "idle" }, runInBackground: true })

    // then
    expect(result).toEqual({ kind: "skipped", reason: "already-notified" })
    expect(calls).toHaveLength(0)
  })
})

describe("createCompletionNotifier - gating", () => {
  test("#given synchronous foreground task #when it completes #then never notifies", () => {
    // given
    const record = baseRecord()
    const { store } = fakeStore([record])
    const { notifier, calls } = fakeNotifier()
    const completion = createCompletionNotifier({ notifier, store })

    // when
    const result = completion.notifyTerminal({ record, parentState: { kind: "idle" }, runInBackground: false })

    // then
    expect(result).toEqual({ kind: "skipped", reason: "sync-task" })
    expect(calls).toHaveLength(0)
  })

  test("#given parent-initiated cancel or interrupt #when terminal #then never notifies", () => {
    // given
    const cancelled = baseRecord({ status: "cancelled", final_response: undefined })
    const interrupted = baseRecord({ status: "interrupted", final_response: undefined })
    const { store } = fakeStore([cancelled])
    const { notifier, calls } = fakeNotifier()
    const completion = createCompletionNotifier({ notifier, store })

    // when
    const cancelResult = completion.notifyTerminal({ record: cancelled, parentState: { kind: "idle" }, runInBackground: true })
    const interruptResult = completion.notifyTerminal({ record: interrupted, parentState: { kind: "idle" }, runInBackground: true })

    // then
    expect(cancelResult).toEqual({ kind: "skipped", reason: "non-notifying-terminal" })
    expect(interruptResult).toEqual({ kind: "skipped", reason: "non-notifying-terminal" })
    expect(calls).toHaveLength(0)
  })

  test("#given still-running task #when notified #then skipped as non-terminal", () => {
    // given
    const record = baseRecord({ status: "running", final_response: undefined })
    const { store } = fakeStore([record])
    const { notifier } = fakeNotifier()
    const completion = createCompletionNotifier({ notifier, store })

    // when
    const result = completion.notifyTerminal({ record, parentState: { kind: "idle" }, runInBackground: true })

    // then
    expect(result).toEqual({ kind: "skipped", reason: "not-terminal" })
  })
})

describe("createCompletionNotifier - routing table", () => {
  function route(parentState: ParentState) {
    const record = baseRecord()
    const { store } = fakeStore([record])
    const { notifier, calls } = fakeNotifier()
    const completion = createCompletionNotifier({ notifier, store })
    const result = completion.notifyTerminal({ record, parentState, runInBackground: true })
    return { result, calls, completion }
  }

  test("#given idle parent #when delivered #then triggerTurn payload recorded unconditionally", () => {
    // when
    const { result, calls } = route({ kind: "idle" })

    // then an idle parent always wakes with a triggerTurn payload
    expect(result).toEqual({ kind: "delivered", decision: "wake" })
    expect(calls[0]?.triggerTurn).toBe(true)
  })

  test("#given streaming parent #when delivered #then triggerTurn payload recorded for the batched steer", () => {
    // when
    const { result, calls } = route({ kind: "streaming" })

    // then a streaming completion also guarantees a turn; the adapter steers the batched injection
    expect(result).toEqual({ kind: "delivered", decision: "deliver_streaming" })
    expect(calls[0]?.triggerTurn).toBe(true)
  })

  test("#given compacting parent #when notified #then buffered without delivery", () => {
    // when
    const { result, calls } = route({ kind: "compacting" })

    // then
    expect(result).toEqual({ kind: "buffered", reason: "compacting" })
    expect(calls).toHaveLength(0)
  })

  test("#given session_switching parent #when notified #then buffered without delivery", () => {
    // when
    const { result, calls } = route({ kind: "session_switching" })

    // then
    expect(result).toEqual({ kind: "buffered", reason: "session_switching" })
    expect(calls).toHaveLength(0)
  })
})

describe("createCompletionNotifier - buffering, flush, batching", () => {
  test("#given two buffered completions on one session #when flushed on idle #then one wake carries both", () => {
    // given
    const first = baseRecord({ task_id: "st_aaaa", name: "one" })
    const second = baseRecord({ task_id: "st_bbbb", name: "two" })
    const { store, replaced } = fakeStore([first, second])
    const { notifier, calls } = fakeNotifier()
    const completion = createCompletionNotifier({ notifier, store })
    completion.notifyTerminal({ record: first, parentState: { kind: "compacting" }, runInBackground: true })
    completion.notifyTerminal({ record: second, parentState: { kind: "compacting" }, runInBackground: true })

    // when
    const flush = completion.flushBuffered({ sessionId: "parent-session", replaced: false })

    // then
    expect(flush).toEqual({ kind: "flushed", count: 2 })
    expect(calls).toHaveLength(1)
    expect(calls[0]?.triggerTurn).toBe(true)
    expect(calls[0]?.details).toHaveLength(2)
    expect(replaced.map((record) => record.notification.notified_epoch)).toEqual([0, 0])
  })

  test("#given buffered completion #when the session was replaced #then it is dropped, not delivered", () => {
    // given
    const record = baseRecord()
    const { store, events, replaced } = fakeStore([record])
    const { notifier, calls } = fakeNotifier()
    const completion = createCompletionNotifier({ notifier, store })
    completion.notifyTerminal({ record, parentState: { kind: "session_shutdown" }, runInBackground: true })

    // when
    const flush = completion.flushBuffered({ sessionId: "parent-session", replaced: true })

    // then
    expect(flush).toEqual({ kind: "dropped", count: 1 })
    expect(calls).toHaveLength(0)
    expect(replaced).toHaveLength(0)
    expect(events.some((entry) => entry.event.type === "notification_dropped")).toBe(true)
  })

  test("#given no buffered notifications #when flushed #then empty result", () => {
    // given
    const record = baseRecord()
    const { store } = fakeStore([record])
    const { notifier } = fakeNotifier()
    const completion = createCompletionNotifier({ notifier, store })

    // when
    const flush = completion.flushBuffered({ sessionId: "parent-session", replaced: false })

    // then
    expect(flush).toEqual({ kind: "empty" })
  })
})

describe("createCompletionNotifier - notifier failure contract", () => {
  test("#given first enqueue throws but retry succeeds #when delivered #then one retry lands and epoch advances", () => {
    // given
    const record = baseRecord()
    const { store, replaced } = fakeStore([record])
    const { notifier, calls } = fakeNotifier(1)
    const completion = createCompletionNotifier({ notifier, store })

    // when
    const result = completion.notifyTerminal({ record, parentState: { kind: "idle" }, runInBackground: true })

    // then
    expect(result).toEqual({ kind: "delivered", decision: "wake" })
    expect(calls).toHaveLength(1)
    expect(replaced.at(-1)?.notification.notified_epoch).toBe(0)
  })

  test("#given enqueue throws twice #when delivered #then failure recorded and epoch not advanced", () => {
    // given
    const record = baseRecord()
    const { store, events, replaced } = fakeStore([record])
    const { notifier, calls } = fakeNotifier(2)
    const completion = createCompletionNotifier({ notifier, store })

    // when
    const result = completion.notifyTerminal({ record, parentState: { kind: "idle" }, runInBackground: true })

    // then
    expect(result).toEqual({ kind: "failed" })
    expect(calls).toHaveLength(0)
    expect(events.some((entry) => entry.event.type === "notification_failed")).toBe(true)
    const persisted = replaced.at(-1)
    expect(persisted?.notification.notification_failed_epoch).toBe(0)
    expect(persisted?.notification.notified_epoch).toBe(-1)
  })
})
