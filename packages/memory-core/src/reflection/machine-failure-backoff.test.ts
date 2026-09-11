import { describe, expect, it } from "bun:test"
import { evaluateTransitions, type MachineState } from "./machine"

describe("reflection automatic failure backoff", () => {
  const state = (now = "2026-09-11T00:00:00.000Z", failures = 0, eligible?: string): MachineState => ({
    journal: { conversationId: "c", state: { schema_version: "v3_assistant_steps", total_completed_steps: 5, reflected_completed_steps: 0, steps_since_last_successful_reflection: 5, pending_compaction: false, consecutive_failures: failures, ...(eligible ? { next_eligible_at: eligible } : {}) }, snapshot: null }, reservation: {}, config: { stepCount: 5, onCompaction: true }, now,
  } as MachineState)
  it("backs off automatic evaluation until the exact deadline, while manual bypasses", () => {
    expect(evaluateTransitions(state(undefined, 1, "2026-09-11T00:00:10.000Z"), { kind: "settled", success: true }).action).toEqual({ kind: "none" })
    expect(evaluateTransitions(state(undefined, 1, "2026-09-11T00:00:10.000Z"), { kind: "manual" }).action.kind).toBe("reserve")
  })
  it("legacy state remains eligible", () => expect(evaluateTransitions(state(), { kind: "settled", success: true }).action.kind).toBe("reserve"))
})
