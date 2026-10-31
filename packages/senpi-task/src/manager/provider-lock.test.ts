import { describe, expect, test } from "bun:test"

import { handOffToNextRung } from "../lifecycle/fallback-handoff"
import { createTaskRecord, type ResolvedModelRecord, type TaskRecord } from "../state"
import { chainAfterHop, runtimeFallbackCandidates } from "./credential-failure"
import { withParentModelRung } from "./parent-model-rung"
import { PROVIDER_LOCK_EXHAUSTED, terminalFailureFields } from "./provider-lock"
import type { ManagerStartSpec, ResolvedChildPlan } from "./types"

const rung = (provider: string, id: string): ResolvedModelRecord => ({ source: "category", provider, model_id: id, display: `${provider}/${id}` })

const ASTRA = rung("chatgpt-subscription", "gpt-6-astra")
const ASTRA_API = rung("openai", "gpt-6-astra")
const SOL = rung("chatgpt-subscription", "gpt-5.6-sol")
const OPUS = rung("anthropic-subscription", "claude-opus-5-5")
const GLM = rung("zai", "glm-5.3")
const LIMIT = "The chatgpt-subscription account usage limit has been reached (resets 3pm)."

const spec = (parent: string, category = "deep-high"): ManagerStartSpec => ({ prompt: "p", parent_session_id: "p", depth: 0, category, parent_model: parent })

const plan = (chain: readonly ResolvedModelRecord[], providerLock?: boolean): ResolvedChildPlan => {
  const [head, ...rest] = chain
  if (head === undefined) throw new Error("empty chain")
  return {
    model: head.display, resolved_model: head, requested_model: head, category: "deep-high",
    ...(rest.length === 0 ? {} : { fallback_models: rest }),
    ...(providerLock === undefined ? {} : { providerLock }),
  }
}

function recordOf(routedPlan: ResolvedChildPlan, parentModel: string | undefined, providerLock: string | undefined): TaskRecord {
  return {
    ...createTaskRecord({
      parent_session_id: "p", root_session_id: "p", depth: 1, execution_mode: "process", notify_on_terminal: false,
      model: routedPlan.model, category: "deep-high",
      ...(routedPlan.resolved_model === undefined ? {} : { resolved_model: routedPlan.resolved_model, requested_model: routedPlan.resolved_model }),
      ...(routedPlan.fallback_models === undefined ? {} : { fallback_models: routedPlan.fallback_models }),
    }),
    ...(parentModel === undefined ? {} : { parent_model: parentModel }),
    ...(providerLock === undefined ? {} : { provider_lock: providerLock }),
  }
}

function modelsVisitedWhenEveryRungIsLimited(record: TaskRecord): readonly string[] {
  const visited = [record.model]
  let current = record
  for (;;) {
    const candidates = runtimeFallbackCandidates(current, LIMIT)
    const next = candidates.remaining[0]
    if (next === undefined) return visited
    current = handOffToNextRung(current, { model: next, remaining: chainAfterHop(candidates), timestamp: "2026-10-31T00:00:00.000Z" })
    visited.push(next.display)
  }
}

describe("a provider-locked category never inherits a cross-vendor parent model (#12006)", () => {
  test("#given an all-OpenAI chain with provider_lock true and a Claude parent #when every rung hits its usage limit #then the child never runs on the parent's model", () => {
    // given
    const routed = withParentModelRung(plan([ASTRA, ASTRA_API, SOL], true), spec(OPUS.display))

    // when
    const visited = modelsVisitedWhenEveryRungIsLimited(recordOf(routed.plan, routed.parentModel, routed.providerLock))

    // then
    expect(visited).not.toContain(OPUS.display)
    expect(routed.parentModel).toBeUndefined()
    expect(routed.providerLock).toBe("openai")
  })

  test("#given an all-OpenAI chain without provider_lock and a Claude parent #when routed #then the #10750 parent rung is appended as before", () => {
    // when
    const routed = withParentModelRung(plan([ASTRA, SOL]), spec(OPUS.display))

    // then
    expect(routed.plan.fallback_models?.map((model) => model.display)).toEqual([SOL.display, OPUS.display])
    expect(routed.parentModel).toBe(OPUS.display)
    expect(routed.providerLock).toBeUndefined()
  })

  test("#given an all-OpenAI chain with provider_lock true and a GPT parent outside the chain #when routed #then the same-vendor parent rung is still appended", () => {
    // when
    const routed = withParentModelRung(plan([ASTRA], true), spec("openai/gpt-6.1-sol"))

    // then
    expect(routed.plan.fallback_models?.map((model) => model.display)).toEqual(["openai/gpt-6.1-sol"])
    expect(routed.providerLock).toBeUndefined()
  })

  test("#given a mixed-vendor chain without provider_lock #when routed #then the parent rung is appended exactly as before", () => {
    // when
    const routed = withParentModelRung(plan([OPUS, GLM]), spec("chatgpt-subscription/gpt-6.1-sol"))

    // then
    expect(routed.plan.fallback_models?.map((model) => model.display)).toEqual([GLM.display, "chatgpt-subscription/gpt-6.1-sol"])
    expect(routed.parentModel).toBe("chatgpt-subscription/gpt-6.1-sol")
    expect(routed.providerLock).toBeUndefined()
  })

  test("#given a mixed-vendor chain with provider_lock true #when the parent's vendor is not in the chain #then no parent rung is added", () => {
    // when
    const routed = withParentModelRung(plan([OPUS, GLM], true), spec("chatgpt-subscription/gpt-6.1-sol"))

    // then
    expect(routed.plan.fallback_models?.map((model) => model.display)).toEqual([GLM.display])
    expect(routed.providerLock).toBe("anthropic, zai")
  })

  test("#given a mixed-vendor chain with provider_lock true #when the parent's vendor is in the chain #then the parent rung is still appended", () => {
    // when
    const routed = withParentModelRung(plan([OPUS, GLM], true), spec("anthropic/claude-fable-5-1"))

    // then
    expect(routed.parentModel).toBe("anthropic/claude-fable-5-1")
    expect(routed.providerLock).toBeUndefined()
  })

  test("#given an all-OpenAI chain with provider_lock false #when routed with a Claude parent #then the #10750 parent rung is kept", () => {
    // when
    const routed = withParentModelRung(plan([ASTRA], false), spec(OPUS.display))

    // then
    expect(routed.parentModel).toBe(OPUS.display)
    expect(routed.providerLock).toBeUndefined()
  })
})

describe("a locked child that runs out of rungs ends typed (#12006)", () => {
  const locked = (): TaskRecord => recordOf(plan([ASTRA]), undefined, "openai")

  test("#given a locked deep-high child #when its last rung hits a usage limit #then it fails as provider_lock_exhausted naming the category and the reset", () => {
    // when
    const fields = terminalFailureFields(locked(), { message: LIMIT })

    // then
    expect(fields.failure_kind).toBe(PROVIDER_LOCK_EXHAUSTED)
    expect(fields.error_message).toContain("category \"deep-high\"")
    expect(fields.error_message).toContain("until 3pm")
  })

  test("#given a locked child #when it fails for a reason the parent rung never covered #then the failure stays untyped", () => {
    // when
    const fields = terminalFailureFields(locked(), { message: "529: upstream overloaded" })

    // then
    expect(fields.failure_kind).toBeUndefined()
  })

  test("#given an unlocked child #when its last rung hits a usage limit #then the failure stays untyped", () => {
    // when
    const fields = terminalFailureFields(recordOf(plan([ASTRA]), undefined, undefined), { message: LIMIT })

    // then
    expect(fields.failure_kind).toBeUndefined()
  })
})
