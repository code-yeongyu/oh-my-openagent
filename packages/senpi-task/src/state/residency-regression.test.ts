import { describe, expect, test } from "bun:test"

import { parseTaskRecord } from "../store/record-parse"
import { createTaskRecord } from "./record"
import { markRecordLostForReconciliation, transitionTaskRecord } from "./transitions"
import { messageability } from "./messageability"
import type { TaskRecord } from "./types"

function runningRecord(): TaskRecord {
  const record = createTaskRecord({
    parent_session_id: "parent",
    root_session_id: "root",
    depth: 1,
    execution_mode: "process",
    model: "anthropic/claude",
    notify_on_terminal: false,
  })
  return transitionTaskRecord(record, {
    type: "start",
    timestamp: "2026-09-02T00:00:00.000Z",
    pid: 9000,
  }).record
}

describe("terminal rpc messageability", () => {
  test("#given terminal and in-flight detached process records #when messageability is classified #then only terminal records are lazy-revivable", () => {
    expect(messageability("completed", "rpc_detached", "process")).toBe("revive")
    expect(messageability("error", "rpc_detached", "process")).toBe("revive")
    expect(messageability("interrupted", "rpc_detached", "process")).toBe("revive")
    expect(messageability("running", "rpc_detached", "process")).toBe("not-continuable")
    expect(messageability("completed", "persisted_only", "in-process")).toBe("not-continuable")
  })

  test("#given a killed terminal error rpc record #when classified #then it is not-continuable", () => {
    expect(messageability("error", "rpc_detached", "process", true)).toBe("not-continuable")
  })
})

describe("terminal_at lifecycle anchor", () => {
  test("#given a running record #when it enters completed #then terminal_at is stamped at the terminal transition", () => {
    const timestamp = "2026-09-02T00:00:01.000Z"

    const result = transitionTaskRecord(runningRecord(), {
      type: "complete",
      timestamp,
      final_response: "done",
    })

    expect(result.record).toMatchObject({ status: "completed", terminal_at: timestamp })
  })

  test("#given a running record #when reconciliation marks it lost #then terminal_at is stamped", () => {
    const timestamp = "2026-09-02T00:00:02.000Z"

    const result = markRecordLostForReconciliation(runningRecord(), {
      timestamp,
      error_message: "missing child",
    })

    expect(result.record).toMatchObject({ status: "lost", terminal_at: timestamp })
  })

  test("#given a persisted terminal record with terminal_at #when it is parsed #then the timestamp round-trips", () => {
    const parsed = parseTaskRecord({
      task_id: "st_75500008",
      status: "completed",
      residency_state: "resident",
      parent_session_id: "parent",
      root_session_id: "root",
      depth: 1,
      execution_mode: "process",
      model: "anthropic/claude",
      notify_on_terminal: false,
      created_at: "2026-09-02T00:00:00.000Z",
      updated_at: "2026-09-02T00:00:02.000Z",
      terminal_at: "2026-09-02T00:00:01.000Z",
      notification: { run_epoch: 0, notified_epoch: -1 },
    }, "record.json")

    expect(parsed).toMatchObject({ terminal_at: "2026-09-02T00:00:01.000Z" })
  })

  test("#given a legacy terminal record without terminal_at #when it is parsed #then updated_at becomes the frozen terminal anchor", () => {
    const parsed = parseTaskRecord({
      task_id: "st_75500009",
      status: "error",
      residency_state: "rpc_detached",
      parent_session_id: "parent",
      root_session_id: "root",
      depth: 1,
      execution_mode: "process",
      model: "anthropic/claude",
      notify_on_terminal: false,
      created_at: "2026-09-01T00:00:00.000Z",
      updated_at: "2026-09-01T00:00:01.000Z",
      notification: { run_epoch: 0, notified_epoch: -1 },
    }, "record.json")

    expect(parsed.terminal_at).toBe("2026-09-01T00:00:01.000Z")
  })

  test("#given a legacy non-terminal record without terminal_at #when it is parsed #then no terminal anchor is added", () => {
    const parsed = parseTaskRecord({
      task_id: "st_7550000a",
      status: "running",
      residency_state: "resident",
      parent_session_id: "parent",
      root_session_id: "root",
      depth: 1,
      execution_mode: "process",
      model: "anthropic/claude",
      notify_on_terminal: false,
      created_at: "2026-09-01T00:00:00.000Z",
      updated_at: "2026-09-01T00:00:01.000Z",
      notification: { run_epoch: 0, notified_epoch: -1 },
    }, "record.json")

    expect(parsed.terminal_at).toBeUndefined()
  })
})
