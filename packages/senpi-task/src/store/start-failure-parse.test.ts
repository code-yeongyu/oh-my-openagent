import { describe, expect, test } from "bun:test"

import { createTaskRecord, transitionTaskRecord } from "../state"
import { parseTaskRecord } from "./record-parse"

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
    error_message: "The shared host did not finish opening the child session in time (open_timed_out).",
    failure_kind: "session_unavailable",
    failure_reason: "open_timed_out",
  }).record
}

describe("task start failure record parsing", () => {
  test("#given a persisted closed failure class #when the record is parsed #then kind and reason round-trip", () => {
    // given
    const persisted = JSON.parse(JSON.stringify(failedRecord()))

    // when
    const parsed = parseTaskRecord(persisted, "/tmp/task.json")

    // then
    expect(parsed.failure_kind).toBe("session_unavailable")
    expect(parsed.failure_reason).toBe("open_timed_out")
  })

  test("#given an off-enum persisted reason #when the record is parsed #then the diagnostic does not echo it", () => {
    // given
    const secret = "api_key=sk-private"
    const persisted = { ...failedRecord(), failure_reason: secret }

    // when
    const failure = () => parseTaskRecord(persisted, "/tmp/task.json")

    // then
    expect(failure).toThrow("failure_reason has an invalid value")
    expect(failure).not.toThrow(secret)
  })
})
