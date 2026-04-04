import process from "node:process"
import { afterEach, describe, expect, it } from "bun:test"

import { resolveActualContextLimit } from "./context-limit-resolver"

const ANTHROPIC_CONTEXT_ENV_KEY = "ANTHROPIC_1M_CONTEXT"
const VERTEX_CONTEXT_ENV_KEY = "VERTEX_ANTHROPIC_1M_CONTEXT"

const originalAnthropicContextEnv = process.env[ANTHROPIC_CONTEXT_ENV_KEY]
const originalVertexContextEnv = process.env[VERTEX_CONTEXT_ENV_KEY]

function resetContextLimitEnv(): void {
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
    resetContextLimitEnv()
  })

  it("returns cached limit for Anthropic 4.6 models when 1M mode is disabled (GA support)", () => {
    // given
    delete process.env[ANTHROPIC_CONTEXT_ENV_KEY]
    delete process.env[VERTEX_CONTEXT_ENV_KEY]
    const modelContextLimitsCache = new Map<string, number>()
    modelContextLimitsCache.set("anthropic/claude-opus-4-6", 1_000_000)

    // when
    const actualLimit = resolveActualContextLimit("anthropic", "claude-opus-4-6", {
      anthropicContext1MEnabled: false,
      modelContextLimitsCache,
    })

    expect(actualLimit).toBe(1_000_000)
  })

  it("returns default 200K for older Anthropic models when 1M mode is disabled", () => {
    // given
    delete process.env[ANTHROPIC_CONTEXT_ENV_KEY]
    delete process.env[VERTEX_CONTEXT_ENV_KEY]
    const modelContextLimitsCache = new Map<string, number>()
    modelContextLimitsCache.set("anthropic/claude-sonnet-4-5", 500_000)

    // when
    const actualLimit = resolveActualContextLimit("anthropic", "claude-sonnet-4-5", {
      anthropicContext1MEnabled: false,
      modelContextLimitsCache,
    })

    // then
    expect(actualLimit).toBe(200_000)
  })

  it("returns default 200K for Anthropic models without cached limit and 1M mode disabled", () => {
    // given
    delete process.env[ANTHROPIC_CONTEXT_ENV_KEY]
    delete process.env[VERTEX_CONTEXT_ENV_KEY]

    // when
    const actualLimit = resolveActualContextLimit("anthropic", "claude-sonnet-4-5", {
      anthropicContext1MEnabled: false,
    })

    // then
    expect(actualLimit).toBe(200_000)
  })

  it("explicit 1M mode takes priority over cached limit", () => {
    // given
    delete process.env[ANTHROPIC_CONTEXT_ENV_KEY]
    delete process.env[VERTEX_CONTEXT_ENV_KEY]
    const modelContextLimitsCache = new Map<string, number>()
    modelContextLimitsCache.set("anthropic/claude-sonnet-4-5", 200_000)

    // when
    const actualLimit = resolveActualContextLimit("anthropic", "claude-sonnet-4-5", {
      anthropicContext1MEnabled: true,
      modelContextLimitsCache,
    })

    expect(actualLimit).toBe(1_000_000)
  })

  it("treats Anthropics aliases as Anthropic providers", () => {
    // given
    delete process.env[ANTHROPIC_CONTEXT_ENV_KEY]
    delete process.env[VERTEX_CONTEXT_ENV_KEY]

    // when
    const actualLimit = resolveActualContextLimit(
      "aws-bedrock-anthropic",
      "claude-sonnet-4-5",
      { anthropicContext1MEnabled: false },
    )

    // then
    expect(actualLimit).toBe(200000)
  })

  it("supports Anthropic 4.6 dot-version model IDs without explicit 1M mode", () => {
    // given
    delete process.env[ANTHROPIC_CONTEXT_ENV_KEY]
    delete process.env[VERTEX_CONTEXT_ENV_KEY]
    const modelContextLimitsCache = new Map<string, number>()
    modelContextLimitsCache.set("anthropic/claude-opus-4.6", 1_000_000)

    // when
    const actualLimit = resolveActualContextLimit("anthropic", "claude-opus-4.6", {
      anthropicContext1MEnabled: false,
      modelContextLimitsCache,
    })

    // then
    expect(actualLimit).toBe(1_000_000)
  })

  it("supports Anthropic 4.6 high-variant model IDs without widening older models", () => {
    // given
    delete process.env[ANTHROPIC_CONTEXT_ENV_KEY]
    delete process.env[VERTEX_CONTEXT_ENV_KEY]
    const modelContextLimitsCache = new Map<string, number>()
    modelContextLimitsCache.set("anthropic/claude-sonnet-4-6-high", 500_000)

    // when
    const actualLimit = resolveActualContextLimit("anthropic", "claude-sonnet-4-6-high", {
      anthropicContext1MEnabled: false,
      modelContextLimitsCache,
    })

    // then
    expect(actualLimit).toBe(500_000)
  })

  it("ignores stale cached limits for older Anthropic models with suffixed IDs", () => {
    // given
    delete process.env[ANTHROPIC_CONTEXT_ENV_KEY]
    delete process.env[VERTEX_CONTEXT_ENV_KEY]
    const modelContextLimitsCache = new Map<string, number>()
    modelContextLimitsCache.set("anthropic/claude-sonnet-4-5-high", 500_000)

    // when
    const actualLimit = resolveActualContextLimit("anthropic", "claude-sonnet-4-5-high", {
      anthropicContext1MEnabled: false,
      modelContextLimitsCache,
    })

    // then
    expect(actualLimit).toBe(200_000)
  })

  it("returns null for non-Anthropic providers without a cached limit", () => {
    // given
    delete process.env[ANTHROPIC_CONTEXT_ENV_KEY]
    delete process.env[VERTEX_CONTEXT_ENV_KEY]

    // when
    const actualLimit = resolveActualContextLimit("openai", "gpt-5", {
      anthropicContext1MEnabled: false,
    })

    // then
    expect(actualLimit).toBeNull()
  })
})
