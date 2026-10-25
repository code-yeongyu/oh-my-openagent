import { describe, expect, it } from "bun:test"

import { taskRecord } from "./event-bridge.test-fixtures"
import { wireHarness } from "./event-bridge.test-harness"
import { formatTaskRow } from "./status-row-format"

describe("effective model surfaces (F12)", () => {
  it("#given a child switched by an operator #when /tasks renders #then the row names the live model with the operator mark", () => {
    const record = taskRecord({
      task_id: "st_operator_switch",
      status: "running",
      effective_model: { provider: "anthropic", model_id: "claude-opus-5-5", display: "anthropic/claude-opus-5-5", reasoning: "high", source: "set", switched_by_operator: true },
    })
    const row = formatTaskRow(record)
    expect(row).toContain("anthropic/claude-opus-5-5:high")
    expect(row).toContain("(switched by operator)")
    expect(row).not.toContain("mock/worker")
  })

  it("#given a child whose fallback reverted #when /tasks renders #then the row names the restored model without the mark", () => {
    const record = taskRecord({
      task_id: "st_fallback_reverted",
      status: "running",
      effective_model: { provider: "kimi-coding", model_id: "kimi-for-coding-highspeed-unlocked", display: "kimi-coding/kimi-for-coding-highspeed-unlocked", source: "fallback-revert" },
    })
    const row = formatTaskRow(record)
    expect(row).toContain("kimi-coding/kimi-for-coding-highspeed-unlocked")
    expect(row).not.toContain("(switched by operator)")
  })

  it("#given a record with an effective model #when the snapshot emits #then the omo.task.updated payload carries effective_model", async () => {
    const record = taskRecord({
      task_id: "st_effective_payload",
      status: "running",
      effective_model: { provider: "anthropic", model_id: "claude-opus-5-5", display: "anthropic/claude-opus-5-5", reasoning: "high", source: "set", switched_by_operator: true },
    })
    const { pi } = wireHarness("parent-session", { records: { [record.task_id]: record }, withRpc: true })

    await pi.dispatch("session_start", {}, {})

    const payload = pi.rpcEvents[0]?.data as { tasks: Array<Record<string, unknown>> }
    const row = payload.tasks.find((task) => task.task_id === "st_effective_payload")
    expect(row?.effective_model).toEqual({
      provider: "anthropic",
      model_id: "claude-opus-5-5",
      display: "anthropic/claude-opus-5-5",
      reasoning: "high",
      source: "set",
      switched_by_operator: true,
    })
  })
})
