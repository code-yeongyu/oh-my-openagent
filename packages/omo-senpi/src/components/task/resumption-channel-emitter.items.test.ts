import { describe, expect, it } from "bun:test"

import type { OmoTaskSettings } from "@oh-my-opencode/omo-config-core"
import type { ListScope, ListedTask, TaskRecord } from "@oh-my-opencode/senpi-task"

import { FakeExtensionAPI } from "../../../test-support/fake-extension-api"
import { createResumptionChannelEmitter } from "./resumption-channel-emitter"

const SESSION_ID = "parent-session"

function child(taskId: string, summary: string, createdAt: string): TaskRecord {
  return {
    task_id: taskId,
    name: `child-${taskId}`,
    task_summary: summary,
    description: summary,
    parent_session_id: SESSION_ID,
    root_session_id: SESSION_ID,
    depth: 1,
    execution_mode: "in-process",
    model: "omo-mock/mock-1",
    status: "running",
    residency_state: "resident",
    created_at: createdAt,
    updated_at: createdAt,
    notification: { run_epoch: 0, notified_epoch: -1 },
    notify_on_terminal: true,
  }
}

type Payload = {
  readonly source: string
  readonly activeCount: number
  readonly items?: readonly { readonly id: string; readonly description?: string; readonly startedAtMs?: number }[]
}

function createHarness(records: TaskRecord[]) {
  const emitted: Payload[] = []
  const pi = new FakeExtensionAPI()
  pi.events = { emit: (_name, data) => emitted.push(data as Payload), on: () => () => {} }
  const emitter = createResumptionChannelEmitter({
    pi,
    manager: {
      list: (_scope: ListScope): readonly ListedTask[] => records.map((record) => ({ record })),
      wasBackground: (taskId: string) => records.find((record) => record.task_id === taskId)?.notify_on_terminal === true,
    },
    sessionId: () => SESSION_ID,
    stateDir: { project_dir: "/tmp/omo-resumption-channel-items-test" },
    settings: {} as OmoTaskSettings,
    isOwnedTeamMember: async () => false,
  })
  return { emitted, emitter, records }
}

describe("resumption-channel emitter wake-source items (#10026)", () => {
  it("#given two live background children #when the session snapshot is emitted #then each child is a senpi wake-source item", async () => {
    // given
    const first = child("st_00000011", "Index the repo", "2026-10-14T01:00:00.000Z")
    const second = child("st_00000012", "Draft the notes", "2026-10-14T01:05:00.000Z")
    const harness = createHarness([first, second])

    // when
    await harness.emitter.emitSessionStart()

    // then
    const payload = harness.emitted.at(-1)
    expect(payload?.activeCount).toBe(2)
    expect(payload?.items).toEqual([
      { id: first.task_id, description: "Index the repo", startedAtMs: Date.parse(first.created_at) },
      { id: second.task_id, description: "Draft the notes", startedAtMs: Date.parse(second.created_at) },
    ])
  })

  it("#given one live child #when it completes while another starts in the same mutation #then a new snapshot names the new child", async () => {
    // given
    const first = child("st_00000021", "First pass", "2026-10-14T02:00:00.000Z")
    const harness = createHarness([first])
    await harness.emitter.emitSessionStart()
    harness.emitted.length = 0

    // when: the count stays at one, but the live child is a different one
    const second = child("st_00000022", "Second pass", "2026-10-14T02:10:00.000Z")
    harness.records.splice(0, 1, { ...first, status: "completed" }, second)
    await harness.emitter.emitIfChanged()

    // then
    expect(harness.emitted).toHaveLength(1)
    expect(harness.emitted[0]?.activeCount).toBe(1)
    expect(harness.emitted[0]?.items?.map((item) => item.id)).toEqual([second.task_id])
  })
})
