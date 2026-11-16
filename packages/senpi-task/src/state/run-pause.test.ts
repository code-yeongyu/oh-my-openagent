import { describe, expect, test } from "bun:test"
import { createTaskRecord } from "./record"
import { transitionTaskRecord } from "./transitions"

const at = "2026-10-21T00:00:00.000Z"

function running() {
  const pending = createTaskRecord({
    parent_session_id: "parent",
    root_session_id: "parent",
    depth: 0,
    execution_mode: "in-process",
    model: "test/model",
    notify_on_terminal: true,
  })
  return transitionTaskRecord(pending, { type: "start", timestamp: at }).record
}

describe("user Stop is a nonterminal task pause", () => {
  test("#given running work #when paused and unpaused #then identity and epoch survive", () => {
    const before = running()
    const paused = transitionTaskRecord(before, { type: "pause", timestamp: at })
    expect(paused.applied).toBe(true)
    expect(paused.record.status).toBe("paused")
    expect(paused.record.terminal_at).toBeUndefined()
    expect(paused.record.notification).toEqual(before.notification)
    expect(paused.record.task_id).toBe(before.task_id)
    const resumed = transitionTaskRecord(paused.record, { type: "unpause", timestamp: at })
    expect(resumed.applied).toBe(true)
    expect(resumed.record.status).toBe("running")
    expect(resumed.record.started_at).toBe(before.started_at)
  })

  test("#given a paused task #when cancelled #then cancellation remains terminal", () => {
    const paused = transitionTaskRecord(running(), { type: "pause", timestamp: at }).record
    const cancelled = transitionTaskRecord(paused, { type: "cancel", timestamp: at })
    expect(cancelled.applied).toBe(true)
    expect(cancelled.record.status).toBe("cancelled")
    expect(cancelled.record.terminal_at).toBe(at)
    expect(transitionTaskRecord(cancelled.record, { type: "unpause", timestamp: at }).applied).toBe(false)
  })

  test("#given paused work #when the old turn completes #then it cannot terminalize the pause", () => {
    const paused = transitionTaskRecord(running(), { type: "pause", timestamp: at }).record
    expect(transitionTaskRecord(paused, { type: "complete", timestamp: at, final_response: "old" }).applied).toBe(false)
    expect(transitionTaskRecord(paused, { type: "fail", timestamp: at, error_message: "aborted" }).applied).toBe(false)
    expect(transitionTaskRecord(paused, { type: "pause", timestamp: at }).applied).toBe(false)
  })
})
