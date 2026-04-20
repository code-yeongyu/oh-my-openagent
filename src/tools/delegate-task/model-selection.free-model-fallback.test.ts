/// <reference types="bun-types" />

import { beforeEach, describe, expect, mock, spyOn, test } from "bun:test"
import { resolveModelForDelegateTask } from "./model-selection"
import * as connectedProvidersCache from "../../shared/connected-providers-cache"

describe("resolveModelForDelegateTask free-only fallback", () => {
  beforeEach(() => {
    mock.restore()
    spyOn(connectedProvidersCache, "hasConnectedProvidersCache").mockReturnValue(true)
    spyOn(connectedProvidersCache, "hasProviderModelsCache").mockReturnValue(true)
    spyOn(connectedProvidersCache, "readConnectedProvidersCache").mockReturnValue(["opencode"])
  })

  test("uses a free opencode fallback instead of a paid category default when only free providers are configured", () => {
    const result = resolveModelForDelegateTask({
      categoryDefaultModel: "opencode/gpt-5.4",
      fallbackChain: [
        { providers: ["opencode"], model: "gpt-5.4", variant: "medium" },
        { providers: ["opencode"], model: "big-pickle" },
      ],
      availableModels: new Set([
        "opencode/gpt-5.4",
        "opencode/big-pickle",
        "opencode/kimi-k2.5-free",
      ]),
    })

    expect(result).toEqual({
      model: "opencode/big-pickle",
      fallbackEntry: { providers: ["opencode"], model: "big-pickle" },
      matchedFallback: true,
    })
  })

  test("falls back to a free global opencode model when the hardcoded chain only contains paid models", () => {
    const result = resolveModelForDelegateTask({
      fallbackChain: [
        { providers: ["opencode"], model: "gpt-5.4", variant: "high" },
        { providers: ["anthropic"], model: "claude-opus-4-6", variant: "max" },
      ],
      availableModels: new Set(),
    })

    expect(result).toEqual({
      model: "opencode/big-pickle",
      fallbackEntry: { providers: ["opencode"], model: "big-pickle" },
      matchedFallback: true,
    })
  })

  test("keeps an explicit user-configured category model even in free-only mode", () => {
    const result = resolveModelForDelegateTask({
      categoryDefaultModel: "opencode/gpt-5.4",
      isUserConfiguredCategoryModel: true,
      availableModels: new Set(["opencode/gpt-5.4", "opencode/big-pickle"]),
    })

    expect(result).toEqual({ model: "opencode/gpt-5.4" })
  })
})
