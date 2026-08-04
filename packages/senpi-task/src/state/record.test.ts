import { describe, expect, test } from "bun:test"

import { createTaskRecord } from "./record"
import type { PendingSteeringEntry, TaskRecord, TaskRecordInput } from "./types"

function baseInput(overrides: Partial<TaskRecordInput> = {}): TaskRecordInput {
  return {
    parent_session_id: "parent-session",
    root_session_id: "root-session",
    depth: 0,
    execution_mode: "in-process",
    model: "gpt-5.2",
    notify_on_terminal: false,
    ...overrides,
  }
}

describe("createTaskRecord durable notification and steering fields", () => {
  test("#given notify_on_terminal true #when the record is created #then the intent lands on the record", () => {
    // given
    const input = baseInput({ notify_on_terminal: true })

    // when
    const record = createTaskRecord(input)

    // then
    expect(record.notify_on_terminal).toBe(true)
  })

  test("#given notify_on_terminal false #when the record is created #then the record carries false explicitly", () => {
    // given
    const input = baseInput()

    // when
    const record = createTaskRecord(input)

    // then
    expect(record.notify_on_terminal).toBe(false)
  })

  test("#given a pending steering queue #when the record is created #then the queue round-trips through JSON", () => {
    // given
    const pendingSteering: readonly PendingSteeringEntry[] = [
      { id: "msg-1", message: "prefer the south gate", deliver_as: "steer" },
      { id: "msg-2", message: "bring the ledger", deliver_as: "followUp" },
    ]

    // when
    const record = createTaskRecord(baseInput({ notify_on_terminal: true, pending_steering: pendingSteering }))
    const restored = JSON.parse(JSON.stringify(record)) as TaskRecord

    // then
    expect(record.pending_steering).toEqual(pendingSteering)
    expect(restored.pending_steering).toEqual(pendingSteering)
    expect(restored.notify_on_terminal).toBe(true)
  })

  test("#given an empty pending steering queue #when the record is created #then the field is omitted", () => {
    // given
    const input = baseInput({ pending_steering: [] })

    // when
    const record = createTaskRecord(input)

    // then
    expect(record.pending_steering).toBeUndefined()
    expect("pending_steering" in record).toBe(false)
  })

  test("#given no pending steering input #when the record is created #then the field stays absent", () => {
    // given
    const input = baseInput()

    // when
    const record = createTaskRecord(input)

    // then
    expect(record.pending_steering).toBeUndefined()
    expect("pending_steering" in record).toBe(false)
  })
})
