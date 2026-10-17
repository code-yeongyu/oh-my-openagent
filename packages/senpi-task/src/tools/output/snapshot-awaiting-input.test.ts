import { describe, expect, test } from "bun:test"

import type { TaskRecord } from "../../state"
import { buildTaskSnapshot } from "./snapshot"

// senpi#3266: a task resumed onto a session that cannot continue on its own shows
// "resumed, waiting for input" (naming why and the one-step actions) instead of "starting".

const NOW = Date.parse("2026-10-14T12:00:00.000Z")

function flagged(overrides: Partial<TaskRecord> = {}): TaskRecord {
  return {
    task_id: "st_0c326601",
    parent_session_id: "parent-1",
    root_session_id: "parent-1",
    depth: 1,
    execution_mode: "process",
    model: "anthropic/claude",
    status: "running",
    residency_state: "resident",
    created_at: "2026-10-14T11:00:00.000Z",
    updated_at: "2026-10-14T11:30:00.000Z",
    notify_on_terminal: false,
    notification: { run_epoch: 1, notified_epoch: -1 },
    runner_kind: "host-session",
    host_session: {
      socket: "/tmp/dh-fake/rpc.sock",
      routing_id: "routing-1",
      session_path: "/tmp/dh-fake/sessions/child.jsonl",
      instance_id: "instance-1",
    },
    awaiting_input: { reason: "resumed_turn_aborted", since: "2026-10-14T11:30:00.000Z" },
    ...overrides,
  }
}

describe("task_output awaiting-input explanation (senpi#3266)", () => {
  test("#given a running record flagged resumed_turn_aborted #when the snapshot is built #then it reads resumed, waiting for input and names the aborted turn", () => {
    // given / when
    const snapshot = buildTaskSnapshot(flagged(), "/tmp/state", NOW)

    // then
    expect(snapshot.awaiting_input?.explanation).toContain("resumed, waiting for input")
    expect(snapshot.awaiting_input?.explanation).toContain("abort")
    expect(snapshot.awaiting_input?.reason).toBe("resumed_turn_aborted")
  })

  test("#given a running record flagged resumed_turn_unfinished #when the snapshot is built #then it names the unfinished turn", () => {
    // given / when
    const snapshot = buildTaskSnapshot(
      flagged({ awaiting_input: { reason: "resumed_turn_unfinished", since: "2026-10-14T11:30:00.000Z" } }),
      "/tmp/state",
      NOW,
    )

    // then
    expect(snapshot.awaiting_input?.explanation).toContain("resumed, waiting for input")
    expect(snapshot.awaiting_input?.reason).toBe("resumed_turn_unfinished")
  })

  test("#given the flag #when the snapshot is built #then the explanation names the one-step actions: cancel or re-dispatch", () => {
    // given / when
    const snapshot = buildTaskSnapshot(flagged(), "/tmp/state", NOW)

    // then
    expect(snapshot.awaiting_input?.explanation).toContain("task_cancel")
    expect(snapshot.awaiting_input?.explanation).toContain("redispatch")
  })

  test("#given a terminal record still carrying the flag #when the snapshot is built #then the waiting state is not shown on a finished result", () => {
    // given / when
    const snapshot = buildTaskSnapshot(flagged({ status: "completed" }), "/tmp/state", NOW)

    // then
    expect(snapshot.awaiting_input).toBeUndefined()
  })

  test("#given a plain running record #when the snapshot is built #then no waiting state appears", () => {
    // given / when
    const snapshot = buildTaskSnapshot(flagged({ awaiting_input: undefined }), "/tmp/state", NOW)

    // then
    expect(snapshot.awaiting_input).toBeUndefined()
  })
})
