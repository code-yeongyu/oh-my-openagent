import { describe, expect, test } from "bun:test"

import type { OmoConfig } from "@oh-my-opencode/omo-config-core"
import type { SenpiModelPort } from "@oh-my-opencode/senpi-task"

import { resolveReflectionModel } from "./resolve-model"

const MODELS: readonly SenpiModelPort[] = [
  { provider: "anthropic", id: "claude-fable-5-1" },
  { provider: "anthropic", id: "claude-opus-5-5" },
  { provider: "openai", id: "gpt-6.1-sol" },
]

const REGISTRY = {
  getAvailable: () => MODELS,
  find: (provider: string, modelId: string) => MODELS.find((model) => model.provider === provider && model.id === modelId),
}

describe("resolveReflectionModel with exclude_models", () => {
  test("#given a user pin outside artistry's chain #when a memory child resolves #then the appended builtin rungs skip the excluded model", () => {
    // given
    const config: OmoConfig = { categories: { artistry: { model: "openai/gpt-6.1-sol" } }, exclude_models: ["claude-fable-*"] }

    // when
    const result = resolveReflectionModel("artistry", config, REGISTRY)

    // then
    if (result.kind !== "resolved") throw new Error(`expected resolved, got ${result.kind}`)
    expect(result.model).toBe("openai/gpt-6.1-sol")
    expect(result.fallbacks.map((candidate) => candidate.model)).toEqual(["anthropic/claude-opus-5-5"])
  })

  test("#given an excluded pin and a stale availability snapshot #when a memory child resolves #then the pin is not revived", () => {
    // given
    const config: OmoConfig = { categories: { quick: { model: "anthropic/claude-fable-5-1" } }, exclude_models: ["claude-fable-5-1"] }

    // when
    const result = resolveReflectionModel("quick", config, REGISTRY)

    // then
    expect(result.kind === "resolved" ? result.model : result.kind).not.toBe("anthropic/claude-fable-5-1")
  })
})
