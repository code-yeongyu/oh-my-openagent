import { describe, expect, test } from "bun:test"
import { parseModelString } from "@oh-my-opencode/model-core"
import { fuzzyMatchModel } from "@oh-my-opencode/model-core"
import { resolveRequestedModelOverride, type RequestedModelDeps } from "./requested-model"

function depsWith(available: string[]): RequestedModelDeps {
  return {
    availableModels: new Set(available),
    parseModelString,
    fuzzyMatchModel,
  }
}

describe("resolveRequestedModelOverride", () => {
  test("#given no model #then kind none (config defaults apply)", () => {
    // when
    const result = resolveRequestedModelOverride({}, depsWith(["openai/gpt-5.5"]))
    // then
    expect(result.kind).toBe("none")
  })

  test("#given blank model string #then kind none", () => {
    const result = resolveRequestedModelOverride({ model: "   " }, depsWith(["openai/gpt-5.5"]))
    expect(result.kind).toBe("none")
  })

  test("#given malformed model #then error", () => {
    // when
    const result = resolveRequestedModelOverride({ model: "not-a-model" }, depsWith(["openai/gpt-5.5"]))
    // then
    expect(result.kind).toBe("error")
    if (result.kind === "error") {
      expect(result.message).toContain("provider/model")
    }
  })

  test("#given model not among connected providers #then error rejects it (gate)", () => {
    // when
    const result = resolveRequestedModelOverride(
      { model: "openai/ghost-999" },
      depsWith(["openai/gpt-5.5", "anthropic/claude-opus-4-8"]),
    )
    // then
    expect(result.kind).toBe("error")
    if (result.kind === "error") {
      expect(result.message).toContain("not available")
    }
  })

  test("#given available model #then resolved with canonical provider/model (gated)", () => {
    // when
    const result = resolveRequestedModelOverride(
      { model: "openai/gpt-5.5" },
      depsWith(["openai/gpt-5.5", "anthropic/claude-opus-4-8"]),
    )
    // then
    expect(result.kind).toBe("resolved")
    if (result.kind === "resolved") {
      expect(result.model.providerID).toBe("openai")
      expect(result.model.modelID).toBe("gpt-5.5")
      expect(result.model.variant).toBeUndefined()
      expect(result.matched).toBe("openai/gpt-5.5")
    }
  })

  test("#given variant in model string #then variant carried", () => {
    // when
    const result = resolveRequestedModelOverride(
      { model: "openai/gpt-5.5 xhigh" },
      depsWith(["openai/gpt-5.5"]),
    )
    // then
    expect(result.kind).toBe("resolved")
    if (result.kind === "resolved") {
      expect(result.model.modelID).toBe("gpt-5.5")
      expect(result.model.variant).toBe("xhigh")
    }
  })

  test("#given explicit reasoningEffort #then it overrides parsed variant", () => {
    // when
    const result = resolveRequestedModelOverride(
      { model: "openai/gpt-5.5 high", reasoningEffort: "xhigh" },
      depsWith(["openai/gpt-5.5"]),
    )
    // then
    expect(result.kind).toBe("resolved")
    if (result.kind === "resolved") {
      expect(result.model.variant).toBe("xhigh")
    }
  })

  test("#given cold cache (no available models) #then resolved passthrough (cannot verify, do not block first call)", () => {
    // when
    const result = resolveRequestedModelOverride({ model: "openai/gpt-5.5 medium" }, depsWith([]))
    // then
    expect(result.kind).toBe("resolved")
    if (result.kind === "resolved") {
      expect(result.model.providerID).toBe("openai")
      expect(result.model.modelID).toBe("gpt-5.5")
      expect(result.model.variant).toBe("medium")
    }
  })
})
