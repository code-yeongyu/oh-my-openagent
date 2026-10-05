import { describe, expect, test } from "bun:test"

import type { TaskRecord } from "../../state"
import { buildTaskSnapshot } from "./snapshot"

const NOW = Date.parse("2026-09-17T12:00:00.000Z")

function parked(reason?: TaskRecord["suspension_reason"]): TaskRecord {
  return {
    task_id: "st_0c000001",
    parent_session_id: "parent-1",
    root_session_id: "parent-1",
    depth: 1,
    execution_mode: "process",
    model: "anthropic/claude",
    status: "running",
    residency_state: "rpc_detached",
    created_at: "2026-09-17T11:00:00.000Z",
    updated_at: "2026-09-17T11:30:00.000Z",
    notify_on_terminal: false,
    notification: { run_epoch: 0, notified_epoch: -1 },
    runner_kind: "host-session",
    host_session: {
      socket: "/tmp/dh-fake/rpc.sock",
      routing_id: "routing-1",
      session_path: "/tmp/dh-fake/sessions/child.jsonl",
      instance_id: "instance-1",
    },
    ...(reason === undefined ? {} : { suspension_reason: reason }),
  }
}

describe("task_output suspension explanation", () => {
  test("#given a host-session child parked because its daemon is gone #when the snapshot is built #then it says the daemon is unavailable", () => {
    // given / when
    const snapshot = buildTaskSnapshot(parked("daemon_unavailable"), "/tmp/state", NOW)

    // then
    expect(snapshot.suspended?.explanation).toBe("suspended (daemon unavailable)")
  })

  test("#given a host-session child suspended while a generation drains #when the snapshot is built #then it names the draining host", () => {
    // given / when
    const snapshot = buildTaskSnapshot(parked("host_draining"), "/tmp/state", NOW)

    // then
    expect(snapshot.suspended?.explanation).toBe("suspended (host draining)")
  })

  test("#given a parked child with no recorded suspension reason #when the snapshot is built #then the session-resume wording is unchanged", () => {
    // given / when
    const snapshot = buildTaskSnapshot(parked(), "/tmp/state", NOW)

    // then
    expect(snapshot.suspended?.explanation).toBe("suspended (resumes with session)")
  })
})
