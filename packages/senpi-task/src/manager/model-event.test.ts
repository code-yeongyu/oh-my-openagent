import { afterEach, describe, expect, test } from "bun:test"

import { runTaskOutput } from "../tools/output/output"
import { baseSpec, cleanupProjects, makeManager } from "./__fixtures__/manager-fakes"

afterEach(() => {
  cleanupProjects()
})

function firstText(result: Awaited<ReturnType<typeof runTaskOutput>>): string {
  const first = result.content[0]
  return first?.type === "text" ? first.text : ""
}

const KIMI = "kimi-coding/kimi-for-coding-highspeed-unlocked"

const OPERATOR_SET = {
  type: "model_changed",
  model: { provider: "anthropic", id: "claude-opus-5-5" },
  thinkingLevel: "high",
  source: "set",
}

const FALLBACK_APPLIED = {
  type: "retry_fallback_applied",
  from: "anthropic/claude-opus-5-5",
  to: "chatgpt-subscription/gpt-6-luna-fast:minimal",
  chainKey: KIMI,
  reason: "hard-error",
}

const FALLBACK_REVERTED = {
  type: "retry_fallback_reverted",
  from: "chatgpt-subscription/gpt-6-luna-fast",
  to: KIMI,
}

describe("TaskManager child model tracking (F12)", () => {
  test("#given a running child #when the host switches, falls back and reverts its model #then task_output reports the live model after each and marks the operator switch", async () => {
    // given
    const { manager, store, inProcess, project } = makeManager({
      planner: () => ({
        kind: "resolved",
        plan: {
          model: KIMI,
          category: "quick",
          resolved_model: {
            source: "category",
            provider: "kimi-coding",
            model_id: "kimi-for-coding-highspeed-unlocked",
            display: KIMI,
            reasoning_effort: "minimal",
          },
        },
      }),
    })
    const started = await manager.start(baseSpec())
    if (started.kind !== "started") throw new Error(`Unexpected start result: ${started.kind}`)
    const fake = inProcess.handles.get(started.task_id)
    if (fake === undefined) throw new Error("Fake child handle missing")
    const read = () => {
      const record = store.load(started.task_id)
      if (record === null || record === undefined) throw new Error("record missing")
      return record
    }
    const output = async () =>
      firstText(await runTaskOutput({ manager, stateDir: project }, { task_id: started.task_id, mode: "status" }, "parent-1"))

    // when: an operator switches the child's model from another client
    fake.emit(OPERATOR_SET)

    // then: the record tracks the effective model, marked as the operator's switch
    expect(read().effective_model).toMatchObject({
      provider: "anthropic",
      model_id: "claude-opus-5-5",
      display: "anthropic/claude-opus-5-5",
      reasoning: "high",
      source: "set",
      switched_by_operator: true,
    })
    let text = await output()
    expect(text).toContain("model anthropic/claude-opus-5-5")
    expect(text).toContain("(switched by operator)")

    // when: the engine falls back inside the child
    fake.emit(FALLBACK_APPLIED)

    // then: the live model is the fallback, without the operator mark
    expect(read().resolved_model).toMatchObject({
      provider: "chatgpt-subscription",
      model_id: "gpt-6-luna-fast",
    })
    expect(read().effective_model).toMatchObject({ source: "fallback", model_id: "gpt-6-luna-fast" })
    text = await output()
    expect(text).toContain("chatgpt-subscription/gpt-6-luna-fast")
    expect(text).not.toContain("(switched by operator)")

    // when: the engine reverts the fallback to the original model
    fake.emit(FALLBACK_REVERTED)

    // then: resolved_model is restored and task_output reports the original model again
    expect(read().resolved_model).toMatchObject({
      provider: "kimi-coding",
      model_id: "kimi-for-coding-highspeed-unlocked",
    })
    expect(read().effective_model).toMatchObject({ source: "fallback-revert", provider: "kimi-coding" })
    text = await output()
    expect(text).toContain(KIMI)
    expect(text).not.toContain("(switched by operator)")

    fake.settle({ status: "completed", finalResponse: "done" })
    await manager.waitFor(started.task_id)
  })

  test("#given a status read #when the record carries an effective model #then the snapshot payload carries effective_model", async () => {
    const { manager, store, project } = makeManager({
      planner: () => ({
        kind: "resolved",
        plan: { model: KIMI, category: "quick" },
      }),
    })
    const started = await manager.start(baseSpec())
    if (started.kind !== "started") throw new Error(`Unexpected start result: ${started.kind}`)
    const current = store.load(started.task_id)
    if (current === null || current === undefined) throw new Error("record missing")
    store.replace({
      ...current,
      effective_model: { provider: "anthropic", model_id: "claude-opus-5-5", display: "anthropic/claude-opus-5-5", reasoning: "high", source: "set", switched_by_operator: true },
    })
    const result = await runTaskOutput({ manager, stateDir: project }, { task_id: started.task_id, mode: "status" }, "parent-1")
    expect(result.details).toMatchObject({
      kind: "status",
      snapshot: {
        effective_model: {
          provider: "anthropic",
          model_id: "claude-opus-5-5",
          source: "set",
          switched_by_operator: true,
        },
      },
    })
  })
})
