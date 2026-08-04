import { describe, expect, test } from "bun:test"

import { createCompletionNotifier } from "../completion"
import type {
  ParentNotifierMessage,
  PersistedTaskEvent,
  TaskRecord,
} from "../index"

function completedTeamRecord(): TaskRecord {
  return {
    task_id: "st_team",
    name: "team-worker",
    parent_session_id: "lead-session",
    root_session_id: "lead-session",
    depth: 1,
    agent_type: "worker",
    execution_mode: "process",
    model: "vendor-b/fallback-model",
    requested_model: {
      source: "agent",
      provider: "vendor-a",
      model_id: "primary-model",
      display: "vendor-a/primary-model",
    },
    resolved_model: {
      source: "agent",
      provider: "vendor-b",
      model_id: "fallback-model",
      display: "vendor-b/fallback-model",
    },
    fallback_models: [],
    notify_on_terminal: false,
    status: "completed",
    residency_state: "resident",
    created_at: "2026-07-28T08:00:00.000Z",
    updated_at: "2026-07-28T08:00:03.000Z",
    final_response: "team worker completed",
    notification: { run_epoch: 1, notified_epoch: -1 },
  }
}

describe("team fallback notification", () => {
  test("#given duplicate lead lifecycle triggers #when fallback notification delivers #then the lead receives one factual reroute", () => {
    // given
    const record = completedTeamRecord()
    const records = new Map([[record.task_id, record]])
    const messages: ParentNotifierMessage[] = []
    const completion = createCompletionNotifier({
      notifier: {
        enqueue: (message) => {
          messages.push(message)
        },
      },
      store: {
        load: (taskId: string) => records.get(taskId) ?? null,
        list: () => ({ records: [...records.values()], diagnostics: [] }),
        replace: (next: TaskRecord) => {
          records.set(next.task_id, next)
        },
        mutate: (taskId: string, mutation: (record: TaskRecord) => TaskRecord) => {
          const current = records.get(taskId)
          if (current === undefined) return null
          const next = mutation(current)
          if (next !== current) records.set(taskId, next)
          return next
        },
        appendEvent: (_taskId: string, _event: PersistedTaskEvent) => "events.jsonl",
      },
    })

    // when
    completion.notifyTerminal({
      record,
      parentState: { kind: "streaming" },
      runInBackground: true,
    })
    completion.notifyTerminal({
      record,
      parentState: { kind: "streaming" },
      runInBackground: true,
    })

    // then
    expect(messages).toHaveLength(1)
    expect(messages[0]?.content.match(/fallback:/gu)).toHaveLength(1)
    expect(messages[0]?.content).toContain(
      "fallback:vendor-a/primary-model->vendor-b/fallback-model",
    )
  })
})
