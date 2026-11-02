import { describe, expect, test } from "bun:test"

import { makeRecord } from "../tools/output/__fixtures__/records"
import type { TaskRecord } from "../state"
import { applyModelEvent } from "./runtime-fallback-event"

const KIMI = "kimi-coding/kimi-for-coding-highspeed-unlocked"

describe("applyModelEvent operator attribution (F12)", () => {
  const baseRecord = (): TaskRecord => makeRecord({ task_id: "st_model_event_unit" })

  type UnitStore = {
    load: (taskId: string) => TaskRecord | null | undefined
    replace: (record: TaskRecord) => void
    isOwnEffect?: (effectId: string) => boolean
  }

  const storeOver = (record: TaskRecord, isOwnEffect?: (effectId: string) => boolean): UnitStore => {
    let current = record
    return {
      load: (_taskId: string) => current,
      replace: (next: TaskRecord) => {
        current = next
      },
      ...(isOwnEffect === undefined ? {} : { isOwnEffect }),
    }
  }

  test("#given a set switch whose effectId omo minted #when the event applies #then it is not marked as the operator's", () => {
    const store = storeOver(baseRecord(), (effectId) => effectId === "own-1")
    const ownSwitch = { type: "model_changed", model: { provider: "anthropic", id: "claude-opus-5-5" }, thinkingLevel: "high", source: "set", effectId: "own-1" }
    applyModelEvent(store, "st_model_event_unit", ownSwitch)
    expect(store.load("st_model_event_unit")?.effective_model).toMatchObject({ model_id: "claude-opus-5-5" })
    expect(store.load("st_model_event_unit")?.effective_model?.switched_by_operator).toBeUndefined()
  })

  test("#given a set switch with a foreign effectId and no own-mint knowledge #when the event applies #then it is marked as the operator's", () => {
    for (const store of [storeOver(baseRecord(), (effectId) => effectId === "own-1"), storeOver(baseRecord())]) {
      const foreignSwitch = { type: "model_changed", model: { provider: "anthropic", id: "claude-opus-5-5" }, thinkingLevel: "high", source: "set", effectId: "eff-foreign" }
      applyModelEvent(store, "st_model_event_unit", foreignSwitch)
      expect(store.load("st_model_event_unit")?.effective_model?.switched_by_operator).toBe(true)
    }
  })

  test("#given a restore-source switch #when the event applies #then no operator mark is rendered", () => {
    const store = storeOver(baseRecord())
    const restore = { type: "model_changed", model: { provider: "kimi-coding", id: KIMI.slice("kimi-coding/".length) }, thinkingLevel: "minimal", source: "restore" }
    applyModelEvent(store, "st_model_event_unit", restore)
    expect(store.load("st_model_event_unit")?.effective_model).toMatchObject({ source: "restore" })
    expect(store.load("st_model_event_unit")?.effective_model?.switched_by_operator).toBeUndefined()
  })

  test("#given a reverted fallback with no selector #when the event applies #then resolved_model comes from the first fallback attempt", () => {
    const record = makeRecord({
      task_id: "st_model_event_unit",
      resolved_model: { source: "category", provider: "chatgpt-subscription", model_id: "gpt-6-luna-fast", display: "chatgpt-subscription/gpt-6-luna-fast" },
    })
    const withAttempts: TaskRecord = {
      ...record,
      fallback_attempts: [
        { source: "category", provider: "kimi-coding", model_id: "kimi-for-coding-highspeed-unlocked", display: KIMI, reasoning_effort: "minimal" },
        { source: "category", provider: "chatgpt-subscription", model_id: "gpt-6-luna-fast", display: "chatgpt-subscription/gpt-6-luna-fast" },
      ],
    }
    const store = storeOver(withAttempts)
    const revert = { type: "retry_fallback_reverted", from: "chatgpt-subscription/gpt-6-luna-fast" }
    applyModelEvent(store, "st_model_event_unit", revert)
    expect(store.load("st_model_event_unit")?.resolved_model).toMatchObject({
      provider: "kimi-coding",
      model_id: "kimi-for-coding-highspeed-unlocked",
    })
  })
})
