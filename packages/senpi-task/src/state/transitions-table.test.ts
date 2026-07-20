import { describe, expect, test } from "bun:test"

import { createTaskRecord } from "./record"
import { transitionTaskRecord } from "./transitions"
import { TASK_STATUSES } from "./types"
import type { TaskRecord, TaskStatus, TaskTransition, TaskTransitionResult } from "./types"

const NORMAL_TRANSITION_EVENTS = ["start", "complete", "fail", "cancel", "interrupt", "lose"] as const

type NormalTransitionEvent = (typeof NORMAL_TRANSITION_EVENTS)[number]
type ExpectedNormalTransition = {
  readonly expectedApplied: boolean
  readonly expectedStatus: TaskStatus
  readonly expectedAudit: TaskTransitionResult["audit"]["type"]
}

const expectedNormalTransitionTable: Record<
  TaskStatus,
  Record<NormalTransitionEvent, ExpectedNormalTransition>
> = {
  pending: {
    start: { expectedApplied: true, expectedStatus: "running", expectedAudit: "transition_applied" },
    complete: { expectedApplied: false, expectedStatus: "pending", expectedAudit: "invalid_transition_ignored" },
    fail: { expectedApplied: false, expectedStatus: "pending", expectedAudit: "invalid_transition_ignored" },
    cancel: { expectedApplied: true, expectedStatus: "cancelled", expectedAudit: "transition_applied" },
    interrupt: { expectedApplied: false, expectedStatus: "pending", expectedAudit: "invalid_transition_ignored" },
    lose: { expectedApplied: false, expectedStatus: "pending", expectedAudit: "invalid_transition_ignored" },
  },
  running: {
    start: { expectedApplied: false, expectedStatus: "running", expectedAudit: "invalid_transition_ignored" },
    complete: { expectedApplied: true, expectedStatus: "completed", expectedAudit: "transition_applied" },
    fail: { expectedApplied: true, expectedStatus: "error", expectedAudit: "transition_applied" },
    cancel: { expectedApplied: true, expectedStatus: "cancelled", expectedAudit: "transition_applied" },
    interrupt: { expectedApplied: true, expectedStatus: "interrupted", expectedAudit: "transition_applied" },
    lose: { expectedApplied: false, expectedStatus: "running", expectedAudit: "invalid_transition_ignored" },
  },
  completed: terminalExpectations("completed"),
  error: terminalExpectations("error"),
  cancelled: terminalExpectations("cancelled"),
  interrupted: terminalExpectations("interrupted"),
  lost: terminalExpectations("lost"),
}

function pendingRecord(): TaskRecord {
  return createTaskRecord({
    parent_session_id: "parent-session",
    root_session_id: "root-session",
    depth: 0,
    execution_mode: "direct",
    model: "gpt-5.2",
  })
}

describe("transitionTaskRecord exhaustive lifecycle table", () => {
  test("#given every status and normal transition #when applied #then allowed and rejected outcomes match the lifecycle table", () => {
    // given
    const cases = TASK_STATUSES.flatMap((status) =>
      NORMAL_TRANSITION_EVENTS.map((event) => ({
        status,
        event,
        transition: normalTransitionFor(event),
        expected: expectedNormalTransitionTable[status][event],
      })),
    )

    // when
    const results = cases.map(({ status, event, transition, expected }) => ({
      key: `${status}/${event}`,
      expected,
      result: transitionTaskRecord({ ...pendingRecord(), status }, transition),
    }))

    // then
    expect(results).toHaveLength(TASK_STATUSES.length * NORMAL_TRANSITION_EVENTS.length)
    for (const { key, expected, result } of results) {
      expect({ key, applied: result.applied }).toEqual({ key, applied: expected.expectedApplied })
      expect({ key, status: result.record.status }).toEqual({ key, status: expected.expectedStatus })
      expect({ key, audit: result.audit.type }).toEqual({ key, audit: expected.expectedAudit })
    }
  })
})

function terminalExpectations(
  status: TaskStatus,
): Record<NormalTransitionEvent, ExpectedNormalTransition> {
  return {
    start: { expectedApplied: false, expectedStatus: status, expectedAudit: "late_transition_ignored" },
    complete: { expectedApplied: false, expectedStatus: status, expectedAudit: "late_transition_ignored" },
    fail: { expectedApplied: false, expectedStatus: status, expectedAudit: "late_transition_ignored" },
    cancel: { expectedApplied: false, expectedStatus: status, expectedAudit: "late_transition_ignored" },
    interrupt: { expectedApplied: false, expectedStatus: status, expectedAudit: "late_transition_ignored" },
    lose: { expectedApplied: false, expectedStatus: status, expectedAudit: "late_transition_ignored" },
  }
}

function normalTransitionFor(event: NormalTransitionEvent): TaskTransition {
  switch (event) {
    case "start":
      return { type: "start", timestamp: "2026-07-06T00:00:01.000Z", pid: 1234 }
    case "complete":
      return { type: "complete", timestamp: "2026-07-06T00:00:01.000Z", final_response: "done" }
    case "fail":
      return { type: "fail", timestamp: "2026-07-06T00:00:01.000Z", error_message: "failed" }
    case "cancel":
      return { type: "cancel", timestamp: "2026-07-06T00:00:01.000Z", error_message: "cancelled" }
    case "interrupt":
      return { type: "interrupt", timestamp: "2026-07-06T00:00:01.000Z", error_message: "interrupted" }
    case "lose":
      return { type: "lose", timestamp: "2026-07-06T00:00:01.000Z", error_message: "missing child" }
    default:
      return assertNeverNormalTransitionEvent(event)
  }
}

function assertNeverNormalTransitionEvent(value: never): never {
  throw new Error(`Unexpected normal transition event: ${JSON.stringify(value)}`)
}
