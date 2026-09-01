import { afterEach, describe, expect, test } from "bun:test"

import { resolveCategory } from "../category"
import { baseSpec, cleanupProjects, makeManager } from "./__fixtures__/manager-fakes"

afterEach(() => {
  cleanupProjects()
})

describe("TaskManager runtime fallback visibility", () => {
  test("#given a running category child #when Senpi applies a fallback #then the task record exposes the actual model", async () => {
    // given
    const { manager, store, inProcess } = makeManager({
      planner: () => ({
        kind: "resolved",
        plan: {
          model: "kimi-coding/kimi-for-coding-highspeed-unlocked",
          category: "quick",
          resolved_model: {
            source: "category",
            provider: "kimi-coding",
            model_id: "kimi-for-coding-highspeed-unlocked",
            display: "kimi-coding/kimi-for-coding-highspeed-unlocked",
            reasoning_effort: "minimal",
          },
        },
      }),
    })
    const started = await manager.start(baseSpec())
    if (started.kind !== "started") throw new Error(`Unexpected start result: ${started.kind}`)
    const fake = inProcess.handles.get(started.task_id)
    if (fake === undefined) throw new Error("Fake child handle missing")
    const fallbackEvent = {
      type: "retry_fallback_applied",
      from: "kimi-coding/kimi-for-coding-highspeed-unlocked",
      to: "openai-codex/gpt-5.6-luna-fast:minimal",
      chainKey: "kimi-coding/kimi-for-coding-highspeed-unlocked",
      reason: "hard-error",
    }

    // when
    fake.emit(fallbackEvent)

    // then
    expect(store.load(started.task_id)).toMatchObject({
      model: "openai-codex/gpt-5.6-luna-fast",
      resolved_model: {
        source: "category",
        provider: "openai-codex",
        model_id: "gpt-5.6-luna-fast",
        display: "openai-codex/gpt-5.6-luna-fast",
        reasoning_effort: "minimal",
      },
    })
    fake.settle({ status: "completed", finalResponse: "done" })
    await manager.waitFor(started.task_id)
  })

  test("#given a builtin category child on a chain rung #when Senpi applies a fallback to the next rung #then the record advances and the remaining chain shrinks", async () => {
    // given
    const models = [
      { provider: "openai-codex", id: "gpt-5.6-luna-fast" },
      { provider: "opencode-go", id: "minimax-m3" },
    ] as const
    const registry = {
      getAvailable: () => models,
      find: (provider: string, modelId: string) =>
        models.find((candidate) => candidate.provider === provider && candidate.id === modelId),
    }
    const { manager, store, inProcess } = makeManager({
      planner: () => {
        const resolution = resolveCategory("quick", {}, registry)
        if (resolution.kind !== "resolved") throw new Error(`Expected resolved category, got ${resolution.kind}`)
        const spec = resolution.spec
        return {
          kind: "resolved",
          plan: {
            model: `${spec.provider}/${spec.modelId}`,
            category: "quick",
            resolved_model: {
              source: "category",
              provider: spec.provider,
              model_id: spec.modelId,
              display: `${spec.provider}/${spec.modelId}`,
              ...(spec.variant !== undefined ? { variant: spec.variant } : {}),
            },
            ...(spec.requested_model !== undefined ? { requested_model: spec.requested_model } : {}),
            ...(spec.fallback_models !== undefined ? { fallback_models: spec.fallback_models } : {}),
          },
        } as const
      },
    })
    const started = await manager.start(baseSpec())
    if (started.kind !== "started") throw new Error(`Unexpected start result: ${started.kind}`)
    const fake = inProcess.handles.get(started.task_id)
    if (fake === undefined) throw new Error("Fake child handle missing")

    // then: the remaining chain rung after the selected one is on the record before any retry
    expect(store.load(started.task_id)).toMatchObject({
      model: "openai-codex/gpt-5.6-luna-fast",
      fallback_models: [
        {
          source: "category",
          provider: "opencode-go",
          model_id: "minimax-m3",
          variant: "max",
        },
      ],
    })

    // when
    const fallbackEvent = {
      type: "retry_fallback_applied",
      from: "openai-codex/gpt-5.6-luna-fast",
      to: "opencode-go/minimax-m3:max",
      chainKey: "openai-codex/gpt-5.6-luna-fast",
      reason: "hard-error",
    }
    fake.emit(fallbackEvent)

    // then
    const record = store.load(started.task_id)
    expect(record).toMatchObject({
      model: "opencode-go/minimax-m3",
      resolved_model: {
        source: "category",
        provider: "opencode-go",
        model_id: "minimax-m3",
        reasoning_effort: "max",
      },
    })
    expect(record?.fallback_models).toEqual([])
    expect(
      record?.fallback_attempts?.map((attempt) => `${attempt.provider}/${attempt.model_id}`),
    ).toEqual(["openai-codex/gpt-5.6-luna-fast", "opencode-go/minimax-m3"])
    fake.settle({ status: "completed", finalResponse: "done" })
    await manager.waitFor(started.task_id)
  })
})
