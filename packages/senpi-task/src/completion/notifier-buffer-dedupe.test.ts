import { describe, expect, test } from "bun:test"

import { createCompletionNotifier } from "./notifier"
import type { ParentNotifier, ParentNotifierMessage, ParentState } from "./types"
import type { TaskRecord } from "../state"
import type { PersistedTaskEvent } from "../store"


function bufferedRecord(): TaskRecord {
  return {
    task_id: "st_dedupe",
    name: "dedupe-me",
    parent_session_id: "parent-session",
    root_session_id: "root-session",
    depth: 1,
    execution_mode: "in-process",
    model: "gpt-5.2",
    status: "completed",
    residency_state: "resident",
    created_at: "2026-07-06T01:00:00.000Z",
    updated_at: "2026-07-06T01:00:03.000Z",
    final_response: "final",
    notification: { run_epoch: 0, notified_epoch: -1 },
  }
}

function fakeStore(seed: TaskRecord) {
  const records = new Map<string, TaskRecord>([[seed.task_id, seed]])
  return {
    load: (taskId: string): TaskRecord | null => records.get(taskId) ?? null,
    replace: (record: TaskRecord): void => {
      records.set(record.task_id, record)
    },
    appendEvent: (_taskId: string, _event: PersistedTaskEvent): string => "log.jsonl",
    list: () => ({ records: [...records.values()], diagnostics: [] }),
  }
}

function fakeNotifier(): { notifier: ParentNotifier; calls: ParentNotifierMessage[] } {
  const calls: ParentNotifierMessage[] = []
  return { notifier: { enqueue: (message) => calls.push(message) }, calls }
}

describe("completion notifier buffered dedupe (W1-V F5)", () => {
  test("#given the same (task,epoch) buffered twice #when flushed #then the parent is notified once", () => {
    // given a compacting parent so both notifyTerminal calls route to the buffer
    const record = bufferedRecord()
    const { notifier: parent, calls } = fakeNotifier()
    const notifier = createCompletionNotifier({ notifier: parent, store: fakeStore(record) })
    const compacting: ParentState = { kind: "compacting" }

    // when notifyTerminal fires twice for the same terminal (task,epoch) before a flush
    notifier.notifyTerminal({ record, parentState: compacting, runInBackground: true })
    notifier.notifyTerminal({ record, parentState: compacting, runInBackground: true })

    // then only one buffered entry survives
    expect(notifier.bufferedCount(record.parent_session_id)).toBe(1)

    // when flushed
    const flushed = notifier.flushBuffered({ sessionId: record.parent_session_id, replaced: false })

    // then exactly one completion detail reaches the parent
    expect(flushed).toEqual({ kind: "flushed", count: 1 })
    expect(calls).toHaveLength(1)
    expect(calls[0]?.details).toHaveLength(1)
  })
})
