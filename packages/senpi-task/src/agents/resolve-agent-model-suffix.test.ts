import { describe, expect, test } from "bun:test"

import { resolveAgent } from "./resolve-agent"
import type { AgentDefinition } from "./types"

// #10380: agents.<name>.models documents a "provider/model:level" string form. It must resolve exactly
// like the object form { model: "provider/model", reasoning: "level" }.

type FakeModel = { readonly provider: string; readonly id: string }

function model(provider: string, id: string): FakeModel {
  return { provider, id }
}

function registry(models: readonly FakeModel[]) {
  return {
    getAvailable: () => models,
    find: (provider: string, modelId: string) =>
      models.find((candidate) => candidate.provider === provider && candidate.id === modelId),
  }
}

function roster(...definitions: readonly AgentDefinition[]): Readonly<Record<string, AgentDefinition>> {
  return Object.fromEntries(definitions.map((definition) => [definition.name, definition]))
}

function expectResolved(result: ReturnType<typeof resolveAgent>): Extract<typeof result, { readonly kind: "resolved" }> {
  if (result.kind !== "resolved") throw new Error(`Expected resolved agent, got ${result.kind}: ${JSON.stringify(result)}`)
  return result
}

const available = registry([
  model("myprovider", "fast-model"),
  model("myprovider", "other-model"),
  model("local", "llama3:8b"),
])

describe("resolveAgent models[] :level suffix (#10380)", () => {
  test("#given a string entry with a :level suffix #when resolved #then it runs that model at that level", () => {
    // given
    const agents = roster({ name: "custom", models: ["myprovider/fast-model:low"] })

    // when
    const result = expectResolved(resolveAgent("custom", agents, available))

    // then
    expect(result.model).toBe("myprovider/fast-model")
    expect(result.resolved_model).toMatchObject({ provider: "myprovider", model_id: "fast-model", reasoning_effort: "low" })
  })

  test("#given the string and object forms of the same entry #when resolved #then both resolve identically", () => {
    // given
    const stringForm = roster({ name: "custom", models: ["myprovider/fast-model:low", "myprovider/other-model:high"] })
    const objectForm = roster({
      name: "custom",
      models: [{ model: "myprovider/fast-model", reasoning: "low" }, { model: "myprovider/other-model", reasoning: "high" }],
    })

    // when
    const fromString = resolveAgent("custom", stringForm, available)
    const fromObject = resolveAgent("custom", objectForm, available)

    // then
    expect(fromString).toEqual(fromObject)
  })

  test("#given a primary model with a :level suffix #when resolved #then the suffix is applied the same way", () => {
    // given
    const agents = roster({ name: "custom", model: "myprovider/fast-model:high" })

    // when
    const result = expectResolved(resolveAgent("custom", agents, available))

    // then
    expect(result.model).toBe("myprovider/fast-model")
    expect(result.resolved_model?.reasoning_effort).toBe("high")
  })

  test("#given a model id whose colon is not a reasoning level #when resolved #then the id stays intact", () => {
    // given
    const agents = roster({ name: "custom", models: ["local/llama3:8b"] })

    // when
    const result = expectResolved(resolveAgent("custom", agents, available))

    // then
    expect(result.model).toBe("local/llama3:8b")
    expect(result.resolved_model?.reasoning_effort).toBeUndefined()
  })

  test("#given an object entry with both a :level suffix and an explicit reasoning #when resolved #then the explicit field wins", () => {
    // given
    const agents = roster({ name: "custom", models: [{ model: "myprovider/fast-model:low", reasoning: "high" }] })

    // when
    const result = expectResolved(resolveAgent("custom", agents, available))

    // then
    expect(result.model).toBe("myprovider/fast-model")
    expect(result.resolved_model?.reasoning_effort).toBe("high")
  })

  test("#given no configured entry is available #when resolved #then the error names the first configured entry", () => {
    // given
    const agents = roster({ name: "custom", models: ["missing/first:low", "missing/second:low"] })

    // when
    const result = resolveAgent("custom", agents, available)

    // then
    expect(result).toMatchObject({ kind: "model_unavailable", attemptedModel: "missing/first" })
  })
})
