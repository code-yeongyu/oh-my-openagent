import { describe, expect, test } from "bun:test"

import type { OmoConfig } from "@oh-my-opencode/omo-config-core"
import type { SenpiModelPort } from "@oh-my-opencode/senpi-task"

import { resolveFactsModel } from "./facts-model"
import { resolveReflectionModel } from "./worker/resolve-model"
import { memorySettings } from "./memory.test-support"

const FABLE: SenpiModelPort = { provider: "anthropic", id: "claude-fable-5-1" }
const OPUS: SenpiModelPort = { provider: "anthropic", id: "claude-opus-5-5" }

function registry(models: readonly SenpiModelPort[]) {
  return {
    getAvailable: () => models,
    find: (provider: string, id: string) => models.find((model) => model.provider === provider && model.id === id),
  }
}

const NO_FABLE: OmoConfig = { exclude_models: ["claude-fable-*"] }
const FABLE_SESSION = { provider: "anthropic", id: "claude-fable-5-1" }

describe("memory children honor exclude_models", () => {
  test("#given an excluded session model and nothing else logged in #when reflection resolves #then it does not inherit the session model", () => {
    // when
    const result = resolveReflectionModel("quick", NO_FABLE, registry([FABLE]), { sessionModel: FABLE_SESSION })

    // then
    expect(result.kind === "resolved" ? result.model : result.kind).not.toBe("anthropic/claude-fable-5-1")
  })

  test("#given an excluded configured facts model #when the facts model resolves #then it is unavailable", () => {
    // given
    const config: OmoConfig = { ...NO_FABLE, memory: memorySettings({ facts: { enabled: true, debounce_settles: 1, model: "anthropic/claude-fable-5-1" } }) }

    // when
    const result = resolveFactsModel(config, registry([FABLE, OPUS]), undefined, "agent")

    // then
    expect(result.kind).toBe("category_unavailable")
  })

  test("#given an excluded session model and no facts model #when the facts model resolves #then the session model is not used", () => {
    // when
    const result = resolveFactsModel(NO_FABLE, registry([FABLE, OPUS]), FABLE_SESSION, "agent")

    // then
    expect(result.kind === "resolved" ? result.model : result.kind).not.toBe("anthropic/claude-fable-5-1")
  })
})
