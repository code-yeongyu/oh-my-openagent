import { describe, expect, test } from "bun:test"

import { makeRecord } from "../tools/output/__fixtures__/records"
import { buildTaskSnapshot } from "../tools/output/snapshot"
import { taskOutputModelText } from "../tools/output/renderers"
import { parseTaskRecord } from "../store/record-parse"
import { applyModelEvent } from "./runtime-fallback-event"
import type { TaskRecord } from "../state"

describe("child fallback provenance", () => {
  test.each([
    { reason: "transient", expected: "fell back from vendor/primary: transient" },
    { reason: "billing", limit: "model", expected: "fell back from vendor/primary: limit" },
  ])("fallback without a reset reports only observed facts: $reason", ({ reason, limit, expected }) => {
    let record = makeRecord({ model: "vendor/primary" })
    const store = { load: () => record, replace: (next: TaskRecord) => { record = next } }
    const event = { type: "retry_fallback_applied", from: "vendor/primary", to: "other/actual", reason, limit }
    applyModelEvent(store, record.task_id, event)
    expect(taskOutputModelText(buildTaskSnapshot(record, "/isolated", 0))).toContain(expected)
    expect(record.model_fallback?.resets_at).toBeUndefined()
  })
  test("a limited child retains the actual model, reason and reset through persistence and task_output", () => {
    // given
    let record: TaskRecord = makeRecord({
      task_id: "st_1234abcd",
      status: "running",
      model: "anthropic/limited",
      resolved_model: { provider: "anthropic", model_id: "limited", display: "anthropic/limited", source: "category" },
    })
    const store = { load: () => record, replace: (next: TaskRecord) => { record = next } }
    // when
    applyModelEvent(store, record.task_id, {
      type: "message_end",
      message: {
        role: "assistant", stopReason: "error", provider: "anthropic", model: "limited",
        errorMessage: "Weekly limit exhausted",
        providerDiagnostic: { category: "quota", resetsAt: "2026-10-21T00:00:00Z" },
      },
    })
    const switched = { type: "model_changed", model: { provider: "openai", id: "actual" }, source: "fallback" }
    applyModelEvent(store, record.task_id, switched)
    const fallback = {
      type: "retry_fallback_applied", from: "anthropic/limited", to: "openai/actual",
      reason: "billing", limit: "account",
    }
    applyModelEvent(store, record.task_id, fallback)
    const persisted = parseTaskRecord(JSON.parse(JSON.stringify(record)), "child.json")
    const snapshot = buildTaskSnapshot(persisted, "/isolated", 0)
    // then
    expect(persisted).toMatchObject({
      effective_model: { provider: "openai", model_id: "actual" },
      model_fallback: { from: "anthropic/limited", reason: "Weekly limit exhausted", limit: "account", resets_at: "2026-10-21T00:00:00Z" },
    })
    expect(taskOutputModelText(snapshot)).toContain("openai/actual")
    expect(taskOutputModelText(snapshot)).toContain("fell back from anthropic/limited: limit, resets 2026-10-21T00:00:00Z")
  })
})
