import { describe, expect, test } from "bun:test"

import { createTaskRecord } from "./record"
import { transitionTaskRecord } from "./transitions"
import type { TaskRecord, TaskTransition } from "./types"

function pendingRecord(): TaskRecord {
  return createTaskRecord({
    parent_session_id: "parent-session",
    root_session_id: "root-session",
    depth: 0,
    execution_mode: "direct",
    model: "gpt-5.2",
  })
}

describe("transitionTaskRecord lifecycle graph", () => {
  test("#given pending task #when terminal transitions arrive before start #then they are rejected", () => {
    // given
    const terminalTransitions: readonly TaskTransition[] = [
      { type: "complete", timestamp: "2026-07-06T00:00:00.000Z", final_response: "done" },
      { type: "fail", timestamp: "2026-07-06T00:00:00.000Z", error_message: "failed" },
      { type: "cancel", timestamp: "2026-07-06T00:00:00.000Z", error_message: "cancelled" },
      { type: "interrupt", timestamp: "2026-07-06T00:00:00.000Z", error_message: "interrupted" },
    ]

    // when
    const results = terminalTransitions.map((transition) => transitionTaskRecord(pendingRecord(), transition))

    // then
    expect(results.map((result) => result.applied)).toEqual([false, false, false, false])
    expect(results.map((result) => result.record.status)).toEqual(["pending", "pending", "pending", "pending"])
    const auditTypes: readonly string[] = results.map((result) => result.audit.type)
    expect(auditTypes).toEqual([
      "invalid_transition_ignored",
      "invalid_transition_ignored",
      "invalid_transition_ignored",
      "invalid_transition_ignored",
    ])
  })

  test("#given running task #when terminal transitions arrive #then the lifecycle terminal is applied", () => {
    // given
    const running = transitionTaskRecord(pendingRecord(), {
      type: "start",
      timestamp: "2026-07-06T00:00:00.000Z",
      pid: 1234,
    }).record
    const terminalTransitions: readonly TaskTransition[] = [
      { type: "complete", timestamp: "2026-07-06T00:00:01.000Z", final_response: "done" },
      { type: "fail", timestamp: "2026-07-06T00:00:01.000Z", error_message: "failed" },
      { type: "cancel", timestamp: "2026-07-06T00:00:01.000Z", error_message: "cancelled" },
      { type: "interrupt", timestamp: "2026-07-06T00:00:01.000Z", error_message: "interrupted" },
    ]

    // when
    const results = terminalTransitions.map((transition) => transitionTaskRecord(running, transition))

    // then
    expect(results.map((result) => result.applied)).toEqual([true, true, true, true])
    expect(results.map((result) => result.record.status)).toEqual([
      "completed",
      "error",
      "cancelled",
      "interrupted",
    ])
  })

  test("#given interrupted task #when late completion arrives #then interrupted remains terminal", () => {
    // given
    const running = transitionTaskRecord(pendingRecord(), {
      type: "start",
      timestamp: "2026-07-06T00:00:00.000Z",
      pid: 1234,
    }).record
    const interrupted = transitionTaskRecord(running, {
      type: "interrupt",
      timestamp: "2026-07-06T00:00:01.000Z",
      error_message: "operator interrupt",
    }).record

    // when
    const lateComplete = transitionTaskRecord(interrupted, {
      type: "complete",
      timestamp: "2026-07-06T00:00:02.000Z",
      final_response: "too late",
    })

    // then
    expect(lateComplete.applied).toBe(false)
    expect(lateComplete.record.status).toBe("interrupted")
    expect(lateComplete.audit.type).toBe("late_transition_ignored")
  })
})
