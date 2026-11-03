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

function createHarness(
  records: TaskRecord[],
  poolTaskIds: readonly string[] = [],
  ownsTask: (taskId: string) => boolean = (taskId) => poolTaskIds.includes(taskId),
  warnings: string[] = [],
) {
  const emitted: Payload[] = []
  // Every pool store read is counted, whether one task is probed or the whole owned set is read at once.
  const poolReads = { count: 0 }
  const workpools = {
    ownsTask: (taskId: string) => {
      poolReads.count += 1
      return ownsTask(taskId)
    },
    ownedTaskIds: () => {
      poolReads.count += 1
      return new Set(records.map((record) => record.task_id).filter((taskId) => ownsTask(taskId)))
    },
  }
  const pi = new FakeExtensionAPI()
  pi.events = { emit: (_name, data) => emitted.push(data as Payload), on: () => () => {} }
  const emitter = createResumptionChannelEmitter({
    pi,
    manager: {
      list: (_scope: ListScope): readonly ListedTask[] => records.map((record) => ({ record })),
      wasBackground: (taskId: string) => records.find((record) => record.task_id === taskId)?.notify_on_terminal === true,
      workpools,
    },
    logger: { warn: (message: string) => warnings.push(message) },
    sessionId: () => SESSION_ID,
    stateDir: { project_dir: "/tmp/omo-resumption-channel-items-test" },
    settings: {} as OmoTaskSettings,
    isOwnedTeamMember: async () => false,
  })
  return { emitted, emitter, records, poolReads }
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

  it("#given a live workpool worker #when the session snapshot is emitted #then it is a children wake-source item (#10782)", async () => {
    // given a pool worker: claimed with notify_on_terminal false, so it is neither background nor a team member
    const worker = { ...child("st_00000031", "Pool worker", "2026-10-24T01:00:00.000Z"), notify_on_terminal: false }
    const harness = createHarness([worker], [worker.task_id])

    // when
    await harness.emitter.emitSessionStart()

    // then the pool keeps the parent's lifecycle waiting on its children
    const payload = harness.emitted.at(-1) as Payload & { readonly kind?: string }
    expect(payload?.kind).toBe("children")
    expect(payload?.activeCount).toBe(1)
    expect(payload?.items?.map((item) => item.id)).toEqual([worker.task_id])
  })

  it("#given an unreadable workpool store #when the session snapshot is emitted #then the emission still goes out and the failure is logged once (#10782)", async () => {
    // given a foreground record (so pool ownership is probed), a live background child, and a pool store that throws
    const foreground = { ...child("st_00000041", "Foreground work", "2026-10-24T02:00:00.000Z"), notify_on_terminal: false }
    const background = child("st_00000042", "Draft the notes", "2026-10-24T02:01:00.000Z")
    const warnings: string[] = []
    const harness = createHarness([foreground, background], [], () => {
      throw new Error("store_corrupt")
    }, warnings)

    // when
    await harness.emitter.emitSessionStart()

    // then the emission still goes out, the record the store could not classify stays counted (fail safe), and the
    // corrupt store is reported, not swallowed
    expect(harness.emitted.at(-1)?.items?.map((item) => item.id)).toEqual([foreground.task_id, background.task_id])
    expect(warnings).toHaveLength(1)
  })

  it("#given only pool workers live and an unreadable pool store #when a store change is emitted #then the workers stay counted, so the parent is never told its children are done (#10782)", async () => {
    // given a live pool worker the session already published
    const worker = { ...child("st_00000051", "Pool worker", "2026-10-24T03:00:00.000Z"), notify_on_terminal: false }
    let storeReadable = true
    const harness = createHarness([worker], [], (taskId) => {
      if (!storeReadable) throw new Error("store_corrupt")
      return taskId === worker.task_id
    }, [])
    await harness.emitter.emitSessionStart()
    expect(harness.emitted.at(-1)?.activeCount).toBe(1)

    // when the pool store becomes unreadable and a store change triggers the next snapshot
    storeReadable = false
    await harness.emitter.emitIfChanged()

    // then nothing claims the children are done: the worker is still the one live item
    const last = harness.emitted.at(-1)
    expect(last?.activeCount).toBe(1)
    expect(last?.items?.map((item) => item.id)).toEqual([worker.task_id])
  })

  it("#given many foreground records #when the session snapshot is emitted #then the pool store is read once, not once per record (#10782)", async () => {
    // given five foreground records, each of which needs a pool ownership check
    const records = [1, 2, 3, 4, 5].map((n) => ({ ...child(`st_0000006${n}`, `Foreground ${n}`, "2026-10-24T04:00:00.000Z"), notify_on_terminal: false }))
    const harness = createHarness(records, ["st_00000063"])

    // when
    await harness.emitter.emitSessionStart()

    // then one store read classified every record, and only the pool worker is published
    expect(harness.poolReads.count).toBe(1)
    expect(harness.emitted.at(-1)?.items?.map((item) => item.id)).toEqual(["st_00000063"])
  })
})
