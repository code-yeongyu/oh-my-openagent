import { describe, expect, test } from "bun:test"

import type { SenpiModelPort } from "@oh-my-opencode/senpi-task"

import { createTaskChildPlanner, type TaskModelRegistry } from "./planner"

class SafeNamedModel implements SenpiModelPort {
  readonly provider = "openai"
  readonly id = "gpt-5.6-sol"
  readonly name = "GPT-5.6 Sol"
}

class InheritedNamedModel implements SenpiModelPort {
  readonly provider = "openai"
  readonly id = "gpt-5.6-sol"

  get name(): string {
    return "Inherited Secret Model"
  }
}

class ThrowingNameModel implements SenpiModelPort {
  readonly provider = "openai"
  readonly id = "gpt-5.6-sol"

  get name(): string {
    throw new Error("name getter must not run")
  }
}

class UnsafeNamedModel implements SenpiModelPort {
  readonly provider = "openai"
  readonly id = "gpt-5.6-sol"

  constructor(readonly name: string) {}
}

function registry(model: SenpiModelPort): TaskModelRegistry {
  return {
    getAvailable: () => [model],
    find: (provider, modelId) => provider === model.provider && modelId === model.id ? model : undefined,
  }
}

function displayFor(model: SenpiModelPort): string | undefined {
  const planner = createTaskChildPlanner(
    { categories: { ultrabrain: { model: "openai/gpt-5.6-sol" } } },
    {},
    () => registry(model),
  )
  const result = planner({
    prompt: "Inspect the model boundary.",
    parent_session_id: "parent",
    depth: 0,
    category: "ultrabrain",
  })
  if (result.kind !== "resolved") throw new Error(`Expected resolved plan, got ${result.kind}`)
  return result.plan.resolved_model?.display
}

describe("task planner model-name boundary", () => {
  test("#given an own safe model name #when category planning resolves #then the friendly name is preserved", () => {
    expect(displayFor(new SafeNamedModel())).toBe("GPT-5.6 Sol")
  })

  test("#given an inherited model name #when category planning resolves #then the inherited value is ignored", () => {
    expect(displayFor(new InheritedNamedModel())).toBe("openai/gpt-5.6-sol")
  })

  test("#given a throwing model name accessor #when category planning resolves #then the accessor is never invoked", () => {
    expect(displayFor(new ThrowingNameModel())).toBe("openai/gpt-5.6-sol")
  })

  test("#given terminal controls or an oversized model name #when category planning resolves #then unsafe names are ignored", () => {
    expect(displayFor(new UnsafeNamedModel("GPT\u001b[31m Secret"))).toBe("openai/gpt-5.6-sol")
    expect(displayFor(new UnsafeNamedModel("x".repeat(121)))).toBe("openai/gpt-5.6-sol")
  })
})
