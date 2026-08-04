import { describe, expect, test } from "bun:test"

import { createTaskRecord } from "../state"
import { parseTaskRecord } from "../store/record-parse"
import { buildRecordInput } from "./manager-helpers"
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
    })

    // then
    expect(input.task_summary).toBe("Audit the record plumbing")
  })

  test("#given no task_summary #when the record input is built #then the field stays absent", () => {
    // given / when
    const input = buildRecordInput({ spec: spawnSpec({}), plan: PLAN, name: "auditor", executionMode: "in-process" })

    // then
    expect("task_summary" in input).toBe(false)
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
