import { describe, expect, test } from "bun:test"

import { buildRevived } from "../steering/engine-policy"
import { createTaskRecord } from "./record"
import { transitionTaskRecord } from "./transitions"

function failedRecord() {
  const pending = createTaskRecord({
    parent_session_id: "parent",
    root_session_id: "parent",
    depth: 1,
    execution_mode: "process",
    model: "test/model",
    notify_on_terminal: false,
  })
  const running = transitionTaskRecord(pending, {
    type: "start",
    timestamp: "2026-09-27T00:00:00.000Z",
  }).record
  return transitionTaskRecord(running, {
    type: "fail",
    timestamp: "2026-09-27T00:00:01.000Z",
    error_message: "host unavailable",
    failure_kind: "host_unavailable",
    failure_reason: "host_unreachable",
  }).record
}

describe("task start failure fact reset", () => {
  test("#given an error record #when it is revived #then the prior error class is cleared with the message", () => {
    // given
    const failed = failedRecord()

    // when
    const revived = buildRevived(failed, "2026-09-27T00:00:02.000Z")

    // then
    expect(revived.error_message).toBeUndefined()
    expect(revived.failure_kind).toBeUndefined()
    expect(revived.failure_reason).toBeUndefined()
  })

  test("#given stale failure facts on a running record #when a new unclassified failure lands #then the old class is replaced", () => {
    // given
    const running = buildRevived(failedRecord(), "2026-09-27T00:00:02.000Z")
    const contaminated = {
      ...running,
      failure_kind: "host_unavailable" as const,
      failure_reason: "host_unreachable" as const,
    }

    // when
    const failed = transitionTaskRecord(contaminated, {
      type: "fail",
      timestamp: "2026-09-27T00:00:03.000Z",
      error_message: "different failure",
    }).record

    // then
    expect(failed.failure_kind).toBeUndefined()
    expect(failed.failure_reason).toBeUndefined()
  })
})
