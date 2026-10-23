import { describe, expect, test } from "bun:test"

import { handOffToNextRung } from "../lifecycle/fallback-handoff"
import { createTaskRecord, type ResolvedModelRecord, type TaskRecord } from "../state"
import { chainAfterHop, runtimeFallbackCandidates } from "./credential-failure"
import { activeParentModelFallback, isParentModelRung } from "./parent-model-rung"
import { applyModelEvent } from "./runtime-fallback-event"

const rung = (provider: string, id: string): ResolvedModelRecord => ({ source: "category", provider, model_id: id, display: `${provider}/${id}` })

const A = rung("vendor-a", "one")
const B = rung("vendor-b", "two")
const PARENT = rung("parent-co", "parent")
const LIMIT = "429 Monthly usage limit reached. It will reset in 2 days 8 hours"

function chainRecord(): TaskRecord {
  return {
    ...createTaskRecord({
      parent_session_id: "p", root_session_id: "p", depth: 1, execution_mode: "process", notify_on_terminal: false,
      model: A.display, requested_model: A, resolved_model: A, fallback_models: [B, PARENT],
    }),
    parent_model: PARENT.display,
  }
}

function hop(record: TaskRecord, failure: string): { readonly record: TaskRecord; readonly next: ResolvedModelRecord | undefined } {
  const candidates = runtimeFallbackCandidates(record, failure)
  const next = candidates.remaining[0]
  if (next === undefined) return { record, next }
  return { record: handOffToNextRung(record, { model: next, remaining: chainAfterHop(candidates), timestamp: "2026-10-21T00:00:00.000Z" }), next }
}

describe("a non-limit failure never consumes the parent rung (#10750 review)", () => {
  test.each([
    ["an overload", "529: upstream overloaded, please retry later"],
    ["a tool error surfaced as a turn failure", "tool execution failed: ENOENT: no such file or directory"],
    ["a network error", "fetch failed: ECONNRESET socket hang up"],
    ["an abort", "child turn ended with stopReason \"aborted\""],
  ])("#given %s on the first rung and a usage limit on the next #when the walk continues #then the parent's model is still there", (_label, failure) => {
    // given
    const first = hop(chainRecord(), failure)

    // when
    const second = hop(first.record, LIMIT)

    // then
    expect(first.next).toEqual(B)
    expect(first.record.fallback_models).toEqual([PARENT])
    expect(second.next).toEqual(PARENT)
  })
})

describe("omo's own hop onto the parent's model (#10750 review round 2, #10797)", () => {
  const NOTE = { from_model: A.display, reason: "usage_limit" as const, at: "2026-10-21T00:00:00.000Z" }
  const handedOff = (): TaskRecord => {
    const spent: TaskRecord = { ...chainRecord(), status: "running", fallback_models: [PARENT], effective_model: { ...A, source: "category" } }
    return { ...hop(spent, LIMIT).record, parent_model_fallback: NOTE }
  }

  test("#given omo hands the task to the parent's model #when no child has reported it yet #then the record still names the last observed model and the note reads as switching", () => {
    // when
    const record = handedOff()

    // then
    expect(record.resolved_model).toMatchObject({ provider: PARENT.provider, model_id: PARENT.model_id })
    expect(record.effective_model).toMatchObject({ provider: A.provider, model_id: A.model_id })
    expect(activeParentModelFallback(record)).toMatchObject({ reason: "usage_limit", phase: "switching" })
  })

  // #10807 review rounds 1-2: no ended shape without an observation on the parent's model may render a positive claim.
  test.each([
    ["the handoff never started a child", (record: TaskRecord): TaskRecord => record],
    ["a child spawned without reporting its model and died before its first message", (record: TaskRecord): TaskRecord => ({ ...record, pid: 4242 })],
    ["no child was ever observed on any model (a start-refusal walk onto the parent's rung)", ({ effective_model: _never, ...record }: TaskRecord): TaskRecord => record],
  ])("#given %s #when the task has ended #then the note says the run on the parent's model is unconfirmed", (_label, settle) => {
    // given
    const { fallback_handoff_epoch: _ended, ...stranded } = handedOff()

    // when
    const ended: TaskRecord = { ...settle(stranded), status: "error" }

    // then
    expect(activeParentModelFallback(ended)).toMatchObject({ reason: "usage_limit", phase: "unconfirmed" })
  })

  test("#given no child was ever observed on any model #when the task is still live on the parent's rung #then the note reads as switching, not ran", () => {
    // given
    const { effective_model: _never, ...unobserved } = handedOff()

    // then
    expect(activeParentModelFallback(unobserved)).toMatchObject({ reason: "usage_limit", phase: "switching" })
  })

  test("#given the child reports the parent's model #when the note is read #then it reads as ran", () => {
    // when
    const observed: TaskRecord = { ...handedOff(), effective_model: { ...PARENT, source: "fallback" } }

    // then
    expect(activeParentModelFallback(observed)?.phase).toBeUndefined()
    expect(activeParentModelFallback(observed)?.reason).toBe("usage_limit")
  })
})

describe("the parent-model note follows the child's current model (#10750 review)", () => {
  const moved = (): TaskRecord => ({
    ...chainRecord(),
    model: PARENT.display,
    resolved_model: PARENT,
    effective_model: { ...PARENT, source: "fallback" },
    parent_model_fallback: { from_model: A.display, reason: "unavailable", at: "2026-10-21T00:00:00.000Z" },
  })

  function storeOver(record: TaskRecord) {
    let current = record
    return { load: () => current, replace: (next: TaskRecord) => { current = next }, read: () => current }
  }

  test("#given a child on the parent's model #when the note is read #then it shows", () => {
    expect(activeParentModelFallback(moved())?.reason).toBe("unavailable")
  })

  test("#given senpi reverts the child to its category model #when the revert lands #then no surface claims it runs on the parent's model", () => {
    // given
    const store = storeOver(moved())

    // when
    applyModelEvent(store, "st", { type: "retry_fallback_reverted", ...{ from: PARENT.display, to: A.display } })

    // then
    expect(store.read().parent_model_fallback).toBeUndefined()
    expect(activeParentModelFallback(store.read())).toBeUndefined()
  })

  test("#given an operator switches the child to another model #when the switch lands #then the note is gone", () => {
    // given
    const store = storeOver(moved())

    // when
    applyModelEvent(store, "st", { type: "model_changed", ...{ source: "set", model: { provider: B.provider, id: B.model_id } } })

    // then
    expect(activeParentModelFallback(store.read())).toBeUndefined()
  })

  test("#given a record whose effective model moved without an event #when the note is read #then it is derived away", () => {
    expect(activeParentModelFallback({ ...moved(), effective_model: { ...A, source: "fallback-revert" } })).toBeUndefined()
  })

  test("#given a parent model id containing a colon #when senpi names it in a fallback selector #then it is the parent rung", () => {
    expect(isParentModelRung({ parent_model: "bedrock/anthropic.claude-v2:0" }, "bedrock/anthropic.claude-v2:0")).toBe(true)
    expect(isParentModelRung({ parent_model: "bedrock/anthropic.claude-v2:0" }, "bedrock/anthropic.claude-v2:0:high")).toBe(true)
  })

  test("#given a model id containing a colon #when the selector names the parent #then it still counts as the parent rung", () => {
    const colonParent = rung("bedrock", "anthropic.claude-v2:0")
    const record: TaskRecord = { ...moved(), parent_model: colonParent.display, effective_model: { ...colonParent, source: "fallback" } }
    expect(activeParentModelFallback(record)?.reason).toBe("unavailable")
  })
})
