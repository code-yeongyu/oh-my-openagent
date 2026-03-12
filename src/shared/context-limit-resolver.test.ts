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

  it("returns the default Anthropic limit when 1M mode is disabled despite a cached limit", () => {
    // given
    delete process.env[ANTHROPIC_CONTEXT_ENV_KEY]
    delete process.env[VERTEX_CONTEXT_ENV_KEY]
    const modelContextLimitsCache = new Map<string, number>()
    modelContextLimitsCache.set("anthropic/claude-sonnet-4-5", 123456)

    // when
    const actualLimit = resolveActualContextLimit("anthropic", "claude-sonnet-4-5", {
      anthropicContext1MEnabled: false,
      modelContextLimitsCache,
    })

    // then
    expect(actualLimit).toBe(200000)
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
