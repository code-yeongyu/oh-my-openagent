import process from "node:process"
import { afterEach, describe, expect, it } from "bun:test"

import { resolveActualContextLimit } from "./context-limit-resolver"

const ANTHROPIC_CONTEXT_ENV_KEY = "ANTHROPIC_1M_CONTEXT"
const VERTEX_CONTEXT_ENV_KEY = "VERTEX_ANTHROPIC_1M_CONTEXT"

const originalAnthropicContextEnv = process.env[ANTHROPIC_CONTEXT_ENV_KEY]
const originalVertexContextEnv = process.env[VERTEX_CONTEXT_ENV_KEY]

function restoreContextLimitEnv(): void {
  if (originalAnthropicContextEnv === undefined) {
    delete process.env[ANTHROPIC_CONTEXT_ENV_KEY]
  } else {
    process.env[ANTHROPIC_CONTEXT_ENV_KEY] = originalAnthropicContextEnv
  }

  if (originalVertexContextEnv === undefined) {
    delete process.env[VERTEX_CONTEXT_ENV_KEY]
  } else {
    process.env[VERTEX_CONTEXT_ENV_KEY] = originalVertexContextEnv
  }
}

describe("resolveActualContextLimit", () => {
  afterEach(() => {
    restoreContextLimitEnv()
  })

  it("returns cached limit for non-Anthropic providers", () => {
    const modelContextLimitsCache = new Map<string, number>()
    modelContextLimitsCache.set("openai/gpt-5", 400_000)

    const actualLimit = resolveActualContextLimit("openai", "gpt-5", {
      anthropicContext1MEnabled: false,
      modelContextLimitsCache,
    })

    expect(actualLimit).toBe(400_000)
  })

  it("returns GA 1M for Anthropic 4.6/4.7 models without explicit 1M mode", () => {
    delete process.env[ANTHROPIC_CONTEXT_ENV_KEY]
    delete process.env[VERTEX_CONTEXT_ENV_KEY]

    const actualLimit = resolveActualContextLimit("anthropic", "claude-sonnet-4-6", {
      anthropicContext1MEnabled: false,
    })

    expect(actualLimit).toBe(1_000_000)
  })

  it("returns GA 1M for Anthropic claude-opus-4-8 without explicit 1M mode", () => {
    delete process.env[ANTHROPIC_CONTEXT_ENV_KEY]
    delete process.env[VERTEX_CONTEXT_ENV_KEY]

    const actualLimit = resolveActualContextLimit("anthropic", "claude-opus-4-8", {
      anthropicContext1MEnabled: false,
    })

    expect(actualLimit).toBe(1_000_000)
  })

  it("returns GA 1M for Anthropic claude-opus-4-8-high without explicit 1M mode", () => {
    delete process.env[ANTHROPIC_CONTEXT_ENV_KEY]
    delete process.env[VERTEX_CONTEXT_ENV_KEY]

    const actualLimit = resolveActualContextLimit("anthropic", "claude-opus-4-8-high", {
      anthropicContext1MEnabled: false,
    })

    expect(actualLimit).toBe(1_000_000)
  })

  it("returns GA 1M for Antigravity Claude models served by google", () => {
    delete process.env[ANTHROPIC_CONTEXT_ENV_KEY]
    delete process.env[VERTEX_CONTEXT_ENV_KEY]

    const actualLimit = resolveActualContextLimit("google", "claude-sonnet-4-6", {
      anthropicContext1MEnabled: false,
    })

    expect(actualLimit).toBe(1_000_000)
  })

  it("returns cached limit for Gemini models served by google", () => {
    const modelContextLimitsCache = new Map<string, number>()
    modelContextLimitsCache.set("google/gemini-3.1-pro", 1_048_576)

    const actualLimit = resolveActualContextLimit("google", "gemini-3.1-pro", {
      anthropicContext1MEnabled: false,
      modelContextLimitsCache,
    })

    expect(actualLimit).toBe(1_048_576)
  })

  it("uses cached limit for GA Anthropic models when cache exists", () => {
    delete process.env[ANTHROPIC_CONTEXT_ENV_KEY]
    delete process.env[VERTEX_CONTEXT_ENV_KEY]
    const modelContextLimitsCache = new Map<string, number>()
    modelContextLimitsCache.set("anthropic/claude-opus-4-7", 700_000)

    const actualLimit = resolveActualContextLimit("anthropic", "claude-opus-4-7", {
      anthropicContext1MEnabled: false,
      modelContextLimitsCache,
    })

    expect(actualLimit).toBe(700_000)
  })

  it("returns 1M when ANTHROPIC_1M_CONTEXT=true regardless of model", () => {
    process.env[ANTHROPIC_CONTEXT_ENV_KEY] = "true"
    delete process.env[VERTEX_CONTEXT_ENV_KEY]
    const modelContextLimitsCache = new Map<string, number>()
    modelContextLimitsCache.set("anthropic/claude-sonnet-4-5", 200_000)

    const actualLimit = resolveActualContextLimit("anthropic", "claude-sonnet-4-5", {
      anthropicContext1MEnabled: false,
      modelContextLimitsCache,
    })

    expect(actualLimit).toBe(1_000_000)
  })

  it("returns 1M when VERTEX_ANTHROPIC_1M_CONTEXT=true for Anthropic aliases", () => {
    delete process.env[ANTHROPIC_CONTEXT_ENV_KEY]
    process.env[VERTEX_CONTEXT_ENV_KEY] = "true"

    const actualLimit = resolveActualContextLimit("google-vertex-anthropic", "claude-sonnet-4-5", {
      anthropicContext1MEnabled: false,
    })

    expect(actualLimit).toBe(1_000_000)
  })

  it("returns GA 1M for claude-fable-5 and claude-mythos-5", () => {
    delete process.env[ANTHROPIC_CONTEXT_ENV_KEY]
    delete process.env[VERTEX_CONTEXT_ENV_KEY]

    expect(resolveActualContextLimit("anthropic", "claude-fable-5", {
      anthropicContext1MEnabled: false,
    })).toBe(1_000_000)

    expect(resolveActualContextLimit("anthropic", "claude-mythos-5", {
      anthropicContext1MEnabled: false,
    })).toBe(1_000_000)

    expect(resolveActualContextLimit("anthropic", "claude-sonnet-5", {
      anthropicContext1MEnabled: false,
    })).toBe(1_000_000)
  })

  it("returns GA 1M for claude-opus-4-8", () => {
    delete process.env[ANTHROPIC_CONTEXT_ENV_KEY]
    delete process.env[VERTEX_CONTEXT_ENV_KEY]

    expect(resolveActualContextLimit("anthropic", "claude-opus-4-8", {
      anthropicContext1MEnabled: false,
    })).toBe(1_000_000)
  })

  it("returns GA 1M for claude-fable-5 on google-vertex-anthropic", () => {
    delete process.env[ANTHROPIC_CONTEXT_ENV_KEY]
    delete process.env[VERTEX_CONTEXT_ENV_KEY]

    expect(resolveActualContextLimit("google-vertex-anthropic", "claude-fable-5", {
      anthropicContext1MEnabled: false,
    })).toBe(1_000_000)
  })
})
