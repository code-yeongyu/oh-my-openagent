import { describe, expect, test } from "bun:test"

import originalFailure from "./__fixtures__/usage-limit-original-engine.json"
import pinnedFailure from "./__fixtures__/usage-limit-pinned-engine.json"
import { makeRecord } from "../tools/output/__fixtures__/records"
import { buildTaskSnapshot } from "../tools/output/snapshot"
import { taskOutputModelText } from "../tools/output/renderers"
import { parseTaskRecord } from "../store/record-parse"
import { formatModelFallback } from "../state/model-fallback"
import type { TaskRecord } from "../state"
import { modelFailure, runtimeFallbackNotice } from "./model-fallback-facts"
import { applyModelEvent } from "./runtime-fallback-event"

const FROM = "chatgpt-subscription/gpt-6-astra"
const RESET = "2026-10-27T00:00:00.000Z"

function recordStore() {
  let record = makeRecord({ task_id: "st_1234abcd", model: FROM })
  return {
    load: () => record,
    replace: (next: TaskRecord) => { record = next },
  }
}

describe("published engine fallback contract", () => {
  test.each([
    { version: "2026.10.19-2", message: originalFailure, reset: undefined },
    { version: "2026.10.25-2", message: pinnedFailure, reset: RESET },
  ])("preserves the provider explanation and only observed reset facts from $version", ({ message, reset }) => {
    // given: complete assistant messages captured from the actual published engines.
    const store = recordStore()
    const id = store.load().task_id
    // when: model_changed may precede the engine's fallback event.
    applyModelEvent(store, id, { type: "message_end", message })
    const switched = { type: "model_changed", model: { provider: "openai", id: "actual" }, source: "fallback" }
    applyModelEvent(store, id, switched)
    const fallback = { type: "retry_fallback_applied", from: FROM, to: "openai/actual", reason: "billing", limit: "account" }
    applyModelEvent(store, id, fallback)
    const persisted = parseTaskRecord(JSON.parse(JSON.stringify(store.load())), "child.json")
    const text = taskOutputModelText(buildTaskSnapshot(persisted, "/isolated", 0))
    // then: the provider's reset wording survives even when no structured reset exists.
    expect(text).toContain(message.errorMessage)
    expect(persisted.model_fallback?.resets_at).toBe(reset)
    expect(text.includes(`resets ${RESET}`)).toBe(reset !== undefined)
  })

  test("converts the pinned engine's epoch milliseconds to an ISO reset", () => {
    // given / when
    const failure = modelFailure({ type: "message_end", message: pinnedFailure }, makeRecord({ model: FROM }))
    // then
    expect(failure?.resets_at).toBe(RESET)
  })

  test("does not overwrite a fresh start-failure reason with stored diagnostic facts", () => {
    // given
    const record: TaskRecord = {
      ...makeRecord({ model: FROM }),
      model_failure: { from: FROM, reason: pinnedFailure.errorMessage, limit: "account", resets_at: RESET },
    }
    // when
    const notice = runtimeFallbackNotice(record, "connection refused")
    // then
    expect(notice).toEqual({ from: FROM, reason: "connection refused" })
  })

  test("a successful assistant turn clears a previous failure before a later fallback", () => {
    // given
    const store = recordStore()
    const id = store.load().task_id
    applyModelEvent(store, id, { type: "message_end", message: pinnedFailure })
    // when
    applyModelEvent(store, id, { type: "message_end", message: { ...pinnedFailure, stopReason: "stop" } })
    const fallback = { type: "retry_fallback_applied", from: FROM, to: "openai/actual", reason: "transient" }
    applyModelEvent(store, id, fallback)
    // then
    expect(store.load().model_fallback).toEqual({ from: FROM, reason: "transient" })
    expect(store.load().model_failure).toBeUndefined()
  })

  test("a transient 429 never claims account exhaustion", () => {
    // given
    const message = {
      ...pinnedFailure,
      errorMessage: "Too many requests",
      providerDiagnostic: { category: "rate_limit", evidence: "structured_code", httpStatus: 429, code: "rate_limit_exceeded" },
    }
    // when
    const failure = modelFailure({ type: "message_end", message }, makeRecord({ model: FROM }))
    // then
    expect(failure?.limit).toBeUndefined()
    expect(formatModelFallback(failure)).toContain(message.errorMessage)
  })

  test("a fallback consumes the matching failed message exactly once", () => {
    // given
    const store = recordStore()
    const id = store.load().task_id
    applyModelEvent(store, id, { type: "message_end", message: pinnedFailure })
    const fallback = { type: "retry_fallback_applied", from: FROM, to: "openai/actual", reason: "billing", limit: "account" }
    // when
    applyModelEvent(store, id, fallback)
    // then
    expect(store.load().model_failure).toBeUndefined()
    expect(store.load().model_fallback?.reason).toBe(pinnedFailure.errorMessage)
  })
})
