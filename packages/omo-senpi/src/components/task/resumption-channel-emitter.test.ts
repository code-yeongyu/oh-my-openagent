import { describe, expect, it } from "bun:test"

import type { OmoTaskSettings } from "@oh-my-opencode/omo-config-core"
import type { ListScope, ListedTask, TaskRecord } from "@oh-my-opencode/senpi-task"

import { FakeExtensionAPI } from "../../../test-support/fake-extension-api"
import {
  RESUMPTION_CHANNEL_STATE_EVENT,
  createResumptionChannelEmitter,
} from "./resumption-channel-emitter"

const SESSION_ID = "parent-session"

function taskRecord(overrides: Partial<TaskRecord> = {}): TaskRecord {
  return {
    task_id: "st_00000001",
    name: "research-child",
    task_summary: "Inspect continuation timing",
    description: "Inspect the continuation race",
    parent_session_id: SESSION_ID,
    root_session_id: SESSION_ID,
    depth: 1,
    execution_mode: "in-process",
    model: "omo-mock/mock-1",
    status: "running",
    residency_state: "resident",
    created_at: "2026-08-08T01:02:03.000Z",
    updated_at: "2026-08-08T01:02:04.000Z",
    notification: { run_epoch: 0, notified_epoch: -1 },
    notify_on_terminal: true,
    ...overrides,
  }
}

function createHarness(options: {
  readonly records?: TaskRecord[]
  readonly ownedTaskIds?: ReadonlySet<string>
  readonly withEvents?: boolean
} = {}) {
  const records = options.records ?? []
  const emitted: Array<{ name: string; data: unknown }> = []
  const pi = new FakeExtensionAPI()
  if (options.withEvents !== false) {
    pi.events = {
      emit: (name, data) => emitted.push({ name, data }),
      on: () => () => {},
    }
  }
  const manager = {
    list: (_scope: ListScope): readonly ListedTask[] => records.map((record) => ({ record })),
    wasBackground: (taskId: string) => records.find((record) => record.task_id === taskId)?.notify_on_terminal === true,
  }
  const emitter = createResumptionChannelEmitter({
    pi,
    manager,
    sessionId: () => SESSION_ID,
    stateDir: { project_dir: "/tmp/omo-resumption-channel-test" },
    settings: {} as OmoTaskSettings,
    isOwnedTeamMember: async (record) => options.ownedTaskIds?.has(record.task_id) === true,
  })
  return { emitted, emitter, records }
}

describe("createResumptionChannelEmitter", () => {
  it("#given a background child #when it spawns and then reaches a terminal state #then snapshots transition from one channel to zero", async () => {
    // given
    const child = taskRecord()
    const harness = createHarness({ records: [] })
    await harness.emitter.emitSessionStart()
    harness.emitted.length = 0

    // when
    harness.records.push(child)
    await harness.emitter.emitIfChanged()
    harness.records[0] = { ...child, status: "completed" }
    await harness.emitter.emitIfChanged()

    // then
    expect(harness.emitted).toEqual([
      {
        name: "resumption_channel_state",
        data: {
          source: "senpi-task",
          activeCount: 1,
          channels: [{
            id: "st_00000001",
            description: "Inspect continuation timing",
            startedAtMs: Date.parse("2026-08-08T01:02:03.000Z"),
          }],
        },
      },
      {
        name: "resumption_channel_state",
        data: { source: "senpi-task", activeCount: 0, channels: [] },
      },
    ])
  })

  it("#given a foreground owned team member #when the snapshot is emitted #then the member counts as active", async () => {
    // given
    const member = taskRecord({
      task_id: "st_00000002",
      name: "team:12345678-1234-1234-1234-123456789abc:reviewer",
      task_summary: undefined,
      description: "Review the implementation",
      notify_on_terminal: false,
    })
    const harness = createHarness({ records: [member], ownedTaskIds: new Set([member.task_id]) })

    // when
    await harness.emitter.emitSessionStart()

    // then
    expect(harness.emitted).toEqual([{
      name: "resumption_channel_state",
      data: {
        source: "senpi-task",
        activeCount: 1,
        channels: [{
          id: member.task_id,
          description: "Review the implementation",
          startedAtMs: Date.parse(member.created_at),
        }],
      },
    }])
  })

  it("#given an active child count of one #when a store mutation preserves that count #then no duplicate snapshot is emitted", async () => {
    // given
    const child = taskRecord()
    const harness = createHarness({ records: [child] })
    await harness.emitter.emitSessionStart()
    harness.emitted.length = 0

    // when
    harness.records[0] = { ...child, updated_at: "2026-08-08T01:02:05.000Z" }
    await harness.emitter.emitIfChanged()

    // then
    expect(harness.emitted).toEqual([])
  })

  it("#given an ExtensionAPI without events #when the emitter lifecycle is driven #then registration and emissions are harmless no-ops", async () => {
    // given
    const harness = createHarness({ records: [taskRecord()], withEvents: false })

    // when
    const result = await Promise.all([
      harness.emitter.emitSessionStart(),
      harness.emitter.emitIfChanged(),
      harness.emitter.emitShutdown(),
    ])

    // then
    expect(result).toEqual([undefined, undefined, undefined])
    expect(harness.emitted).toEqual([])
  })

  it("#given the local event contract #when the literal is inspected #then it exactly matches the harness event name", () => {
    // given / when / then
    expect(RESUMPTION_CHANNEL_STATE_EVENT).toBe("resumption_channel_state")
  })
})
