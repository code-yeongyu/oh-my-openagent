import { describe, expect, test } from "bun:test"

import {
  RESIDENCY_STATES,
  TASK_STATUSES,
  createTaskRecord,
  messageability,
  transitionTaskRecord,
} from "../index"
import type { Messageability, ResidencyState, TaskStatus } from "../index"

const expectedMessageability: Record<TaskStatus, Record<ResidencyState, Messageability>> = {
  pending: {
    resident: "steer",
    evicted: "not-continuable",
    disposed: "not-continuable",
    persisted_only: "revive",
    rpc_detached: "revive",
  },
  running: {
    resident: "steer",
    evicted: "not-continuable",
    disposed: "not-continuable",
    persisted_only: "revive",
    rpc_detached: "revive",
  },
  completed: {
    resident: "revive",
    evicted: "not-continuable",
    disposed: "not-continuable",
    persisted_only: "not-continuable",
    rpc_detached: "not-continuable",
  },
  error: {
    resident: "revive",
    evicted: "not-continuable",
    disposed: "not-continuable",
    persisted_only: "not-continuable",
    rpc_detached: "not-continuable",
  },
  cancelled: {
    resident: "not-continuable",
    evicted: "not-continuable",
    disposed: "not-continuable",
    persisted_only: "not-continuable",
    rpc_detached: "not-continuable",
  },
  interrupted: {
    resident: "revive",
    evicted: "not-continuable",
    disposed: "not-continuable",
    persisted_only: "not-continuable",
    rpc_detached: "not-continuable",
  },
  lost: {
    resident: "not-continuable",
    evicted: "not-continuable",
    disposed: "not-continuable",
    persisted_only: "not-continuable",
    rpc_detached: "not-continuable",
  },
}

describe("messageability", () => {
  test("#given every status and residency pair #when classified #then the table is exhaustive", () => {
    // given
    const pairs = TASK_STATUSES.flatMap((status) =>
      RESIDENCY_STATES.map((residency) => ({ status, residency })),
    )

    // when
    const actual = pairs.map(({ status, residency }) => ({
      key: `${status}/${residency}`,
      value: messageability(status, residency),
    }))

    // then
    expect(actual).toHaveLength(TASK_STATUSES.length * RESIDENCY_STATES.length)
    expect(Object.keys(expectedMessageability)).toHaveLength(TASK_STATUSES.length)
    for (const status of TASK_STATUSES) {
      expect(Object.keys(expectedMessageability[status])).toHaveLength(RESIDENCY_STATES.length)
      for (const residency of RESIDENCY_STATES) {
        expect(messageability(status, residency)).toBe(expectedMessageability[status][residency])
      }
    }
  })
})

describe("transitionTaskRecord", () => {
  test("#given a cancelled task #when late failure arrives #then cancelled remains terminal and failure is logged", () => {
    // given
    const record = createTaskRecord({
      parent_session_id: "parent",
      root_session_id: "root",
      depth: 1,
      execution_mode: "direct",
      model: "claude-sonnet-4",
    })
    const running = transitionTaskRecord(record, {
      type: "start",
      timestamp: "2026-07-06T00:00:00.000Z",
      pid: 1234,
    }).record
    const cancelled = transitionTaskRecord(running, {
      type: "cancel",
      timestamp: "2026-07-06T00:00:01.000Z",
      error_message: "user cancelled",
    }).record

    // when
    const lateFailure = transitionTaskRecord(cancelled, {
      type: "fail",
      timestamp: "2026-07-06T00:00:02.000Z",
      error_message: "process exited later",
    })

    // then
    expect(lateFailure.applied).toBe(false)
    expect(lateFailure.record.status).toBe("cancelled")
    expect(lateFailure.record.error_message).toBe("user cancelled")
    expect(lateFailure.audit.type).toBe("late_transition_ignored")
    if (lateFailure.audit.type !== "late_transition_ignored") throw new Error("Expected late transition audit")
    expect(lateFailure.audit.attempted_status).toBe("error")
  })
})
