import { describe, expect, test } from "bun:test"

import { createTaskRecord } from "../state"
import type { TaskRecord } from "../state"
import { parseTaskRecord } from "../store/record-parse"
import { buildRecordInput, promotedBackgroundMode } from "./manager-helpers"
import { TaskSequence } from "./task-sequence"
import type { ManagerStartSpec, ResolvedChildPlan } from "./types"

const PLAN: ResolvedChildPlan = { model: "anthropic/claude-opus-4" }

function spawnSpec(overrides: Partial<ManagerStartSpec>): ManagerStartSpec {
  return {
    prompt: "TASK: Audit the record plumbing.",
    parent_session_id: "session-1",
    depth: 1,
    category: "quick",
    ...overrides,
  }
}

describe("buildRecordInput task_summary", () => {
  test("#given a spawn spec with a task_summary #when the record input is built #then the summary is carried onto the record facts", () => {
    // given / when
    const input = buildRecordInput({
      spec: spawnSpec({ task_summary: "Audit the record plumbing" }),
      plan: PLAN,
      name: "auditor",
      executionMode: "in-process",
      taskSeq: 0,
    })

    // then
    expect(input.task_summary).toBe("Audit the record plumbing")
  })

  test("#given no task_summary #when the record input is built #then the field stays absent", () => {
    // given / when
    const input = buildRecordInput({ spec: spawnSpec({}), plan: PLAN, name: "auditor", executionMode: "in-process", taskSeq: 0 })

    // then
    expect("task_summary" in input).toBe(false)
  })
})

describe("buildRecordInput background_mode", () => {
  test("#given a spawn spec with run_in_background true #when the record is built #then background_mode is \"background\" and a foreground spawn yields \"foreground\"", () => {
    // given / when
    const background = buildRecordInput({
      spec: spawnSpec({ run_in_background: true }),
      plan: PLAN,
      name: "auditor",
      executionMode: "in-process",
      taskSeq: 0,
    })
    const foreground = buildRecordInput({
      spec: spawnSpec({ run_in_background: false }),
      plan: PLAN,
      name: "auditor",
      executionMode: "in-process",
      taskSeq: 1,
    })

    // then
    expect(background.background_mode).toBe("background")
    expect(background.notify_on_terminal).toBe(true)
    expect(foreground.background_mode).toBe("foreground")
    expect(foreground.notify_on_terminal).toBe(false)
  })

  test("#given a spawn spec carrying a task ordinal #when the record is built #then task_seq is carried onto the record facts", () => {
    // given / when
    const input = buildRecordInput({
      spec: spawnSpec({}),
      plan: PLAN,
      name: "auditor",
      executionMode: "in-process",
      taskSeq: 4,
    })

    // then
    expect(input.task_seq).toBe(4)
  })
})

describe("promotedBackgroundMode", () => {
  function record(overrides: Partial<TaskRecord>): TaskRecord {
    const base = createTaskRecord({
      parent_session_id: "session-1",
      root_session_id: "session-1",
      depth: 1,
      execution_mode: "in-process",
      model: "anthropic/claude-opus-4",
      notify_on_terminal: false,
    })
    return { ...base, ...overrides }
  }

  test("#given a record spawned in the foreground #when promoted #then the mode becomes promoted", () => {
    // given / when / then
    expect(promotedBackgroundMode(record({ background_mode: "foreground" }))).toBe("promoted")
  })

  test("#given a record spawned in the background #when promoted #then the mode stays background", () => {
    // given / when / then
    expect(promotedBackgroundMode(record({ background_mode: "background" }))).toBe("background")
  })

  test("#given a legacy record with no mode but durable background intent #when promoted #then the mode is background, not promoted", () => {
    // given / when / then
    expect(promotedBackgroundMode(record({ notify_on_terminal: true }))).toBe("background")
    expect(promotedBackgroundMode(record({ notify_on_terminal: false }))).toBe("promoted")
  })
})

describe("TaskSequence", () => {
  test("#given two parent sessions #when ordinals are drawn #then each session counts from zero independently", () => {
    // given
    const sequence = new TaskSequence()

    // when
    const first = sequence.next("session-a")
    const second = sequence.next("session-a")
    const other = sequence.next("session-b")

    // then
    expect([first, second, other]).toEqual([0, 1, 0])
  })
})

describe("task_summary record roundtrip", () => {
  test("#given a record input with a task_summary #when created and re-parsed from JSON #then the summary survives the persistence roundtrip", () => {
    // given
    const record = createTaskRecord({
      task_summary: "Audit the record plumbing",
      parent_session_id: "session-1",
      root_session_id: "session-1",
      depth: 1,
      execution_mode: "in-process",
      model: "anthropic/claude-opus-4",
      notify_on_terminal: false,
    })

    // when
    const reparsed = parseTaskRecord(JSON.parse(JSON.stringify(record)), "record.json")

    // then
    expect(reparsed.task_summary).toBe("Audit the record plumbing")
  })
})
