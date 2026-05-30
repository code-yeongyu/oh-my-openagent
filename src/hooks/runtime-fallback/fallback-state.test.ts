import { describe, expect, test } from "bun:test"
import { createFallbackState, isEquivalentModel } from "./fallback-state"

describe("runtime fallback state", () => {
  test("#given OpenCode provides a model object #when fallback state is created #then model identity is normalized to a string", () => {
    // given
    const model = {
      providerID: "anthropic",
      modelID: "claude-opus-4-7",
      variant: "max",
    }

    // when
    const state = createFallbackState(model)

    // then
    expect(state.originalModel).toBe("anthropic/claude-opus-4-7(max)")
    expect(state.currentModel).toBe("anthropic/claude-opus-4-7(max)")
  })

  test("#given fallback compares string and object forms of the same model #when checking equivalence #then it does not throw and treats them as equivalent", () => {
    // expect
    expect(isEquivalentModel(
      "anthropic/claude-opus-4-7(max)",
      { providerID: "anthropic", modelID: "claude-opus-4-7", variant: "max" },
    )).toBe(true)
  })
})
