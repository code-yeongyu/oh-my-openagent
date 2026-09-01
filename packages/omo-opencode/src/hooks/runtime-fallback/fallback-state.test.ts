/// <reference types="bun-types" />

import { describe, expect, test } from "bun:test"
import { createFallbackState, findNextAvailableFallback, stringifyRuntimeModelWithVariant } from "./fallback-state"

describe("runtime-fallback fallback state", () => {
  test("#given object-shaped current model #when finding the next fallback #then equivalent models are skipped without crashing", () => {
    // given
    const state = createFallbackState({ providerID: "anthropic", modelID: "claude-sonnet-4-6" })
    const fallbackModels = ["github-copilot/claude-sonnet-4.6", "openai/gpt-5.4"]

    // when
    const nextModel = findNextAvailableFallback(state, fallbackModels, 60)

    // then
    expect(nextModel).toBe("openai/gpt-5.4")
  })

  test("#given model object without variant and top-level variant #when stringifying runtime model #then top-level variant is preserved", () => {
    // given
    const model = { providerID: "github-copilot", modelID: "claude-haiku-4.5" }

    // when
    const runtimeModel = stringifyRuntimeModelWithVariant(model, "high")

    // then
    expect(runtimeModel).toBe("github-copilot/claude-haiku-4.5(high)")
  })

  test("#given model object with its own variant #when stringifying with a top-level variant #then model variant wins", () => {
    // given
    const model = { providerID: "github-copilot", modelID: "claude-haiku-4.5", variant: "low" }

    // when
    const runtimeModel = stringifyRuntimeModelWithVariant(model, "high")

    // then
    expect(runtimeModel).toBe("github-copilot/claude-haiku-4.5(low)")
  })
})
