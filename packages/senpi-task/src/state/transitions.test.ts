import { describe, expect, test } from "bun:test"

import { createTaskRecord } from "./record"
import { markRecordLostForReconciliation, transitionTaskRecord } from "./transitions"
import type { ResidencyState, TaskRecord, TaskStatus, TaskTransition } from "./types"

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

  test("#given pending or running task #when normal lose transition arrives #then lost is rejected", () => {
    // given
    const pending = pendingRecord()
    const running = transitionTaskRecord(pendingRecord(), {
      type: "start",
      timestamp: "2026-07-06T00:00:00.000Z",
      pid: 1234,
    }).record
    const loseTransition: TaskTransition = {
      type: "lose",
      timestamp: "2026-07-06T00:00:01.000Z",
      error_message: "missing on resume",
    }

    // when
    const pendingLost = transitionTaskRecord(pending, loseTransition)
    const runningLost = transitionTaskRecord(running, loseTransition)

    // then
    expect(pendingLost.applied).toBe(false)
    expect(pendingLost.record.status).toBe("pending")
    expect(pendingLost.audit.type).toBe("invalid_transition_ignored")
    expect(runningLost.applied).toBe(false)
    expect(runningLost.record.status).toBe("running")
    expect(runningLost.audit.type).toBe("invalid_transition_ignored")
  })

  test("#given pending or running task #when reconciliation marks lost #then lost is applied explicitly", () => {
    // given
    const pending = pendingRecord()
    const running = transitionTaskRecord(pendingRecord(), {
      type: "start",
      timestamp: "2026-07-06T00:00:00.000Z",
      pid: 1234,
    }).record

    // when
    const pendingLost = markRecordLostForReconciliation(pending, {
      timestamp: "2026-07-06T00:00:01.000Z",
      error_message: "missing pending child",
    })
    const runningLost = markRecordLostForReconciliation(running, {
      timestamp: "2026-07-06T00:00:01.000Z",
      error_message: "missing running child",
    })

    // then
    expect(pendingLost.applied).toBe(true)
    expect(pendingLost.record.status).toBe("lost")
    expect(pendingLost.record.error_message).toBe("missing pending child")
    expect(runningLost.applied).toBe(true)
    expect(runningLost.record.status).toBe("lost")
    expect(runningLost.record.error_message).toBe("missing running child")
  })

  test("#given terminal task #when residency-only transition arrives #then status remains and residency changes", () => {
    // given
    const running = transitionTaskRecord(pendingRecord(), {
      type: "start",
      timestamp: "2026-07-06T00:00:00.000Z",
      pid: 1234,
    }).record
    const completed = transitionTaskRecord(running, {
      type: "complete",
      timestamp: "2026-07-06T00:00:01.000Z",
      final_response: "done",
    }).record

    // when
    const evicted = transitionTaskRecord(completed, {
      type: "evict",
      timestamp: "2026-07-06T00:00:02.000Z",
    })
    const disposed = transitionTaskRecord(completed, {
      type: "dispose",
      timestamp: "2026-07-06T00:00:02.000Z",
    })

    // then
    expect(evicted.applied).toBe(true)
    expect(evicted.record.status).toBe("completed")
    expect(evicted.record.residency_state).toBe("evicted")
    expect(disposed.applied).toBe(true)
    expect(disposed.record.status).toBe("completed")
    expect(disposed.record.residency_state).toBe("disposed")
  })

  test("#given every terminal status #when every residency transition arrives #then only residency changes", () => {
    // given
    const terminalStatuses: readonly TaskStatus[] = ["completed", "error", "cancelled", "interrupted", "lost"]
    const residencyTransitions: ReadonlyArray<{
      readonly transition: TaskTransition
      readonly expected: ResidencyState
    }> = [
      { transition: { type: "evict", timestamp: "2026-07-06T00:00:02.000Z" }, expected: "evicted" },
      { transition: { type: "dispose", timestamp: "2026-07-06T00:00:02.000Z" }, expected: "disposed" },
      { transition: { type: "persist_only", timestamp: "2026-07-06T00:00:02.000Z" }, expected: "persisted_only" },
      { transition: { type: "detach_rpc", timestamp: "2026-07-06T00:00:02.000Z" }, expected: "rpc_detached" },
      { transition: { type: "mark_resident", timestamp: "2026-07-06T00:00:02.000Z" }, expected: "resident" },
    ]

    // when
    const results = terminalStatuses.flatMap((status) =>
      residencyTransitions.map(({ transition, expected }) => ({
        status,
        expected,
        result: transitionTaskRecord({ ...pendingRecord(), status }, transition),
      })),
    )

    // then
    expect(results).toHaveLength(terminalStatuses.length * residencyTransitions.length)
    for (const { status, expected, result } of results) {
      expect(result.applied).toBe(true)
      expect(result.record.status).toBe(status)
      expect(result.record.residency_state).toBe(expected)
    }
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
