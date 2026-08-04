import { describe, expect, test } from "bun:test"
import {
  createCompletionNotifier,
  type ParentNotifierMessage,
  type PersistedTaskEvent,
  type TaskRecord,
} from "@oh-my-opencode/senpi-task"

import type { SenpiExtensionAPI } from "../../extension/types"
import { createParentNotifier } from "./parent-notifier"

type SentMessage = {
  readonly message: Record<string, unknown>
  readonly options: Record<string, unknown> | undefined
}

function fakePi(config: { readonly throwOnSend?: boolean } = {}): SenpiExtensionAPI & { readonly sent: SentMessage[] } {
  const sent: SentMessage[] = []
  return {
    sent,
    on: () => undefined,
    registerTool: () => undefined,
    registerCommand: () => undefined,
    registerFlag: () => undefined,
    getFlag: () => undefined,
    sendMessage: (message, options) => {
      if (config.throwOnSend === true) throw new Error("send failed")
      sent.push({ message, options })
    },
    sendUserMessage: () => undefined,
    registerMessageRenderer: () => undefined,
  }
}

function completedFallbackRecord(): TaskRecord {
  return {
    task_id: "st_team_fallback",
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
    status: "completed",
    residency_state: "resident",
    created_at: "2026-07-28T08:00:00.000Z",
    updated_at: "2026-07-28T08:00:03.000Z",
    final_response: "team worker completed",
    notification: { run_epoch: 0, notified_epoch: -1 },
  }
}

describe("OMO Senpi task component fallback completion", () => {
  test("#given duplicate terminal delivery #when the task component notifies the lead #then it reports model fallback once at terminal completion", () => {
    // given
    const record = completedFallbackRecord()
    const records = new Map([[record.task_id, record]])
    const pi = fakePi()
    const completion = createCompletionNotifier({
      notifier: createParentNotifier(pi),
      store: {
        load: (taskId: string) => records.get(taskId) ?? null,
        list: () => ({ records: [...records.values()], diagnostics: [] }),
        replace: (next: TaskRecord) => {
          records.set(next.task_id, next)
        },
        appendEvent: (_taskId: string, _event: PersistedTaskEvent) => "events.jsonl",
      },
    })

    // when
    completion.notifyTerminal({
      record,
      parentState: { kind: "idle" },
      runInBackground: true,
    })
    completion.notifyTerminal({
      record,
      parentState: { kind: "idle" },
      runInBackground: true,
    })

    // then
    expect(pi.sent).toHaveLength(1)
    const content = String(pi.sent[0]?.message.content)
    expect(content).toContain("fallback:vendor-a/primary-model->vendor-b/fallback-model")
    expect(content.match(/fallback:/gu)).toHaveLength(1)
  })
})

describe("OMO Senpi parent notifier cmux ordering", () => {
  test("#given parent send fails synchronously #when completion enqueue retries #then cmux is not sent for failed attempts", () => {
    // given
    const pi = fakePi({ throwOnSend: true })
    const cmuxMessages: ParentNotifierMessage[] = []
    const notifier = createParentNotifier(pi, undefined, undefined, (message) => cmuxMessages.push(message))
    const message: ParentNotifierMessage = {
      customType: "senpi-task.completion",
      content: "task completion name:worker status:error",
      display: true,
      details: [],
      triggerTurn: true,
    }

    // when / then
    expect(() => notifier.enqueue(message)).toThrow("send failed")
    expect(cmuxMessages).toHaveLength(0)
  })
})
