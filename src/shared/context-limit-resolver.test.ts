import { afterEach, beforeEach, describe, expect, it } from "bun:test"
import { type ContextLimitModelCacheState, resolveActualContextLimit } from "./context-limit-resolver"

describe("resolveActualContextLimit", () => {
  let originalAnthropicEnv: string | undefined
  let originalVertexEnv: string | undefined

  beforeEach(() => {
    originalAnthropicEnv = process.env.ANTHROPIC_1M_CONTEXT
    originalVertexEnv = process.env.VERTEX_ANTHROPIC_1M_CONTEXT
    delete process.env.ANTHROPIC_1M_CONTEXT
    delete process.env.VERTEX_ANTHROPIC_1M_CONTEXT
  })

  afterEach(() => {
    if (originalAnthropicEnv !== undefined) {
      process.env.ANTHROPIC_1M_CONTEXT = originalAnthropicEnv
    } else {
      delete process.env.ANTHROPIC_1M_CONTEXT
    }
    if (originalVertexEnv !== undefined) {
      process.env.VERTEX_ANTHROPIC_1M_CONTEXT = originalVertexEnv
    } else {
      delete process.env.VERTEX_ANTHROPIC_1M_CONTEXT
    }
  })

  //#given anthropic provider without 1M env
  //#when resolving context limit
  //#then returns 200_000 default
  it("returns 200_000 for anthropic provider by default", () => {
    const result = resolveActualContextLimit("anthropic", "claude-sonnet-4-5")
    expect(result).toBe(200_000)
  })

  //#given google-vertex-anthropic provider
  //#when resolving context limit
  //#then returns 200_000 default
  it("returns 200_000 for google-vertex-anthropic provider by default", () => {
    const result = resolveActualContextLimit("google-vertex-anthropic", "claude-sonnet-4-5")
    expect(result).toBe(200_000)
  })

  //#given aws-bedrock-anthropic provider
  //#when resolving context limit
  //#then returns 200_000 default
  it("returns 200_000 for aws-bedrock-anthropic provider by default", () => {
    const result = resolveActualContextLimit("aws-bedrock-anthropic", "claude-sonnet-4-5")
    expect(result).toBe(200_000)
  })

  //#given ANTHROPIC_1M_CONTEXT env is true
  //#when resolving context limit
  //#then returns 1_000_000
  it("returns 1_000_000 when ANTHROPIC_1M_CONTEXT=true", () => {
    process.env.ANTHROPIC_1M_CONTEXT = "true"
    const result = resolveActualContextLimit("anthropic", "claude-sonnet-4-5")
    expect(result).toBe(1_000_000)
  })

  //#given VERTEX_ANTHROPIC_1M_CONTEXT env is true
  //#when resolving context limit
  //#then returns 1_000_000
  it("returns 1_000_000 when VERTEX_ANTHROPIC_1M_CONTEXT=true", () => {
    process.env.VERTEX_ANTHROPIC_1M_CONTEXT = "true"
    const result = resolveActualContextLimit("google-vertex-anthropic", "claude-sonnet-4-5")
    expect(result).toBe(1_000_000)
  })

  //#given modelCacheState with anthropicContext1MEnabled=true
  //#when resolving context limit
  //#then returns 1_000_000
  it("returns 1_000_000 when modelCacheState.anthropicContext1MEnabled=true", () => {
    const state: ContextLimitModelCacheState = { anthropicContext1MEnabled: true }
    const result = resolveActualContextLimit("anthropic", "claude-sonnet-4-5", state)
    expect(result).toBe(1_000_000)
  })

  //#given unknown non-anthropic provider without cache
  //#when resolving context limit
  //#then returns null
  it("returns null for unknown non-anthropic provider", () => {
    const result = resolveActualContextLimit("openai", "gpt-4o")
    expect(result).toBeNull()
  })

  //#given non-anthropic provider with cached limit
  //#when resolving context limit
  //#then returns cached limit
  it("returns cached limit for non-anthropic provider", () => {
    const cache = new Map<string, number>([["openai/gpt-4o", 128_000]])
    const state: ContextLimitModelCacheState = {
      anthropicContext1MEnabled: false,
      modelContextLimitsCache: cache,
    }
    const result = resolveActualContextLimit("openai", "gpt-4o", state)
    expect(result).toBe(128_000)
  })

  //#given anthropic provider with cached limit for supported model
  //#when resolving context limit
  //#then returns cached limit
  it("returns cached limit for supported anthropic model", () => {
    const cache = new Map<string, number>([["anthropic/claude-opus-4-6", 180_000]])
    const state: ContextLimitModelCacheState = {
      anthropicContext1MEnabled: false,
      modelContextLimitsCache: cache,
    }
    const result = resolveActualContextLimit("anthropic", "claude-opus-4-6", state)
    expect(result).toBe(180_000)
  })
})
