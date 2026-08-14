import { describe, expect, it } from "bun:test"

import type { TaskRecord } from "../state"
import { recordSpawnFacts } from "./record-spawn-facts"

function runningRecord(overrides: Partial<TaskRecord> = {}): TaskRecord {
  return {
    task_id: "st_child",
    name: "Inspect auth",
    parent_session_id: "session-parent",
    root_session_id: "session-parent",
    depth: 1,
    execution_mode: "in-process",
    model: "openai/gpt-5.6-mini",
    status: "running",
    residency_state: "resident",
    created_at: "2026-08-14T00:00:00.000Z",
    updated_at: "2026-08-14T00:00:01.000Z",
    notification: { run_epoch: 0, notified_epoch: -1 },
    notify_on_terminal: true,
    ...overrides,
  }
}

describe("recordSpawnFacts", () => {
  it("persists the native child session identity even without an OS pid", () => {
    const current = runningRecord()

    const updated = recordSpawnFacts(current, {
      pid: undefined,
      sessionId: "session-child",
      spawnSpec: undefined,
    })

    expect(updated).not.toBe(current)
    expect(updated.child_session_id).toBe("session-child")
    expect(updated.pid).toBeUndefined()
  })

  it("preserves an authoritative v1 spawn spec while recording identity", () => {
    const current = runningRecord({
      spawn_spec: {
        version: 1,
        cwd: "C:\\repo",
        prompt: "Inspect auth",
      },
    })

    const updated = recordSpawnFacts(current, {
      pid: 4312,
      sessionId: "session-child",
      spawnSpec: {
        cwd: "C:\\different",
        extensions: ["unexpected"],
      },
    })

    expect(updated.child_session_id).toBe("session-child")
    expect(updated.pid).toBe(4312)
    expect(updated.spawn_spec).toEqual(current.spawn_spec)
  })
})
