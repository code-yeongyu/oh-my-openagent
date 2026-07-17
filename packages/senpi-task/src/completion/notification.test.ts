import { describe, expect, test } from "bun:test"

import { buildCompletionDetails, buildCompletionMessage } from "./notification"
import type { TaskRecord } from "../state"

function completedRecord(overrides: Partial<TaskRecord> = {}): TaskRecord {
  return {
    task_id: "st_deadbeef",
    name: "summarize-logs",
    parent_session_id: "parent-session",
    root_session_id: "root-session",
    depth: 1,
    execution_mode: "in-process",
    model: "gpt-5.2",
    status: "completed",
    residency_state: "resident",
    created_at: "2026-07-06T01:00:00.000Z",
    updated_at: "2026-07-06T01:00:03.000Z",
    final_response: "the final answer",
    notification: { run_epoch: 0, notified_epoch: -1 },
    ...overrides,
  }
}

describe("buildCompletionDetails", () => {
  test("#given completed record #when details built #then core facts and duration are populated", () => {
    // given
    const record = completedRecord()

    // when
    const details = buildCompletionDetails(record)

    // then
    expect(details.task_id).toBe("st_deadbeef")
    expect(details.name).toBe("summarize-logs")
    expect(details.status).toBe("completed")
    expect(details.duration_ms).toBe(3000)
    expect(details.final_response_head).toBe("the final answer")
    expect(details.continuation_hint).toContain("st_deadbeef")
  })

  test("#given long final response #when details built #then head is capped at 700 chars", () => {
    // given
    const record = completedRecord({ final_response: "x".repeat(2000) })

    // when
    const details = buildCompletionDetails(record)

    // then
    expect(details.final_response_head.length).toBe(700)
  })

  test("#given resident completed record #when details built #then continuation hint names task_send and task_output", () => {
    // given
    const record = completedRecord()

    // when
    const details = buildCompletionDetails(record)

    // then
    expect(details.continuation_hint).toContain("task_send")
    expect(details.continuation_hint).toContain("task_output")
  })

  test("#given resident completed record #when details built #then task_send hint uses to and message params", () => {
    // given
    const record = completedRecord()

    // when
    const details = buildCompletionDetails(record)

    // then
    expect(details.continuation_hint).toContain("task_send({ to:")
    expect(details.continuation_hint).toContain("message:")
    expect(details.continuation_hint).not.toContain("task_send({ task_id:")
    expect(details.continuation_hint).not.toContain("prompt:")
  })

  test("#given error record #when details built #then error message feeds the head", () => {
    // given
    const record = completedRecord({
      status: "error",
      final_response: undefined,
      error_message: "child crashed",
    })

    // when
    const details = buildCompletionDetails(record)

    // then
    expect(details.status).toBe("error")
    expect(details.final_response_head).toBe("child crashed")
  })

  test("#given tokens provided #when details built #then tokens are attached", () => {
    // given
    const record = completedRecord()

    // when
    const details = buildCompletionDetails(record, { tokens: 1234 })

    // then
    expect(details.tokens).toBe(1234)
  })
})

describe("buildCompletionMessage", () => {
  test("#given single detail #when message built #then friendly task facts replace protocol markup", () => {
    // given
    const details = buildCompletionDetails(completedRecord())

    // when
    const message = buildCompletionMessage([details])

    // then
    expect(message.customType).toBe("senpi-task.completion")
    expect(message.details).toEqual([details])
    expect(message.content).toContain("task completion")
    expect(message.content).toContain("name:summarize-logs")
    expect(message.content).toContain("id:st_deadbeef")
    expect(message.content).toContain("status:completed")
    expect(message.content).toContain("duration:3s")
    expect(message.content).toContain('result:"the final answer"')
    expect(message.content).toContain("task_send")
    expect(message.content).not.toContain("<task-notification>")
    expect(message.content).not.toContain("<head>")
  })

  test("#given two details #when message built #then both completions appear in one content block", () => {
    // given
    const first = buildCompletionDetails(completedRecord({ task_id: "st_aaaa", name: "one" }))
    const second = buildCompletionDetails(completedRecord({ task_id: "st_bbbb", name: "two" }))

    // when
    const message = buildCompletionMessage([first, second])

    // then
    expect(message.details).toHaveLength(2)
    expect(message.content).toContain("one")
    expect(message.content).toContain("two")
    expect(message.content.match(/task completion/gu)).toHaveLength(2)
    expect(message.content).not.toContain("<task-notification>")
  })
})
