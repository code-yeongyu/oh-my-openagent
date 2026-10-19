import { describe, expect, test } from "bun:test"

import { createCompletionNotifier } from "./notifier"
import type { ParentNotifier, ParentNotifierMessage } from "./types"
import type { TaskRecord } from "../state"
import type { PersistedTaskEvent } from "../store"

function interruptedRecord(extra: Partial<TaskRecord> = {}): TaskRecord {
  return {
    task_id: "st_replaced",
    name: "replaced-child",
    parent_session_id: "parent-session",
    root_session_id: "root-session",
    depth: 1,
    execution_mode: "process",
    model: "gpt-5.2",
    status: "interrupted",
    residency_state: "resident",
    created_at: "2026-10-15T01:00:00.000Z",
    updated_at: "2026-10-15T01:00:03.000Z",
    notify_on_terminal: true,
    notification: { run_epoch: 0, notified_epoch: -1 },
    ...extra,
  }
}

function fakeStore(seed: TaskRecord) {
  const records = new Map<string, TaskRecord>([[seed.task_id, seed]])
  return {
    load: (taskId: string): TaskRecord | null => records.get(taskId) ?? null,
    replace: (record: TaskRecord): void => {
      records.set(record.task_id, record)
    },
    mutate: (taskId: string, mutation: (record: TaskRecord) => TaskRecord): TaskRecord | null => {
      const current = records.get(taskId)
      if (current === undefined) return null
      const next = mutation(current)
      if (next !== current) records.set(taskId, next)
      return next
    },
    appendEvent: (_taskId: string, _event: PersistedTaskEvent): string => "log.jsonl",
    list: () => ({ records: [...records.values()], diagnostics: [] }),
  }
}

function fakeParent(): { parent: ParentNotifier; calls: ParentNotifierMessage[] } {
  const calls: ParentNotifierMessage[] = []
  return { parent: { enqueue: (message) => calls.push(message) }, calls }
}

describe("interrupts the parent did not request (omo#10112)", () => {
  test("#given a child interrupted because its session was replaced #when it settles #then the parent is notified with the reason", () => {
    // given
    const record = interruptedRecord({
      interrupt_cause: "session_replaced",
      error_message: "The child's session was replaced (new) by s2, which stopped its running turn. Use task_send to continue it in the new session.",
    })
    const { parent, calls } = fakeParent()
    const notifier = createCompletionNotifier({ notifier: parent, store: fakeStore(record) })

    // when
    const result = notifier.notifyTerminal({ record, parentState: { kind: "idle" }, runInBackground: true })

    // then
    expect(result.kind).toBe("delivered")
    expect(calls).toHaveLength(1)
    expect(JSON.stringify(calls[0])).toContain(String(record.error_message))
  })

  test("#given a child the parent interrupted itself #when it settles #then the parent is not notified", () => {
    // given
    const record = interruptedRecord()
    const { parent, calls } = fakeParent()
    const notifier = createCompletionNotifier({ notifier: parent, store: fakeStore(record) })

    // when
    const result = notifier.notifyTerminal({ record, parentState: { kind: "idle" }, runInBackground: true })

    // then
    expect(result).toEqual({ kind: "skipped", reason: "non-notifying-terminal" })
    expect(calls).toHaveLength(0)
  })
})
