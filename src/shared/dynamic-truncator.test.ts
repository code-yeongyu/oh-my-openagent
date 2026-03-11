/// <reference types="bun-types" />

import { describe, expect, it, afterEach } from "bun:test"

import { getContextWindowUsage } from "./dynamic-truncator"

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

function createContextUsageMockContext(
  inputTokens: number,
  options?: { providerID?: string; modelID?: string; cacheRead?: number }
) {
  return {
    client: {
      session: {
        messages: async () => ({
          data: [
            {
              info: {
                role: "assistant",
                providerID: options?.providerID ?? "anthropic",
                modelID: options?.modelID,
                tokens: {
                  input: inputTokens,
                  output: 0,
                  reasoning: 0,
                  cache: { read: options?.cacheRead ?? 0, write: 0 },
                },
              },
            },
          ],
        }),
      },
    },
  }
}

describe("getContextWindowUsage", () => {
  afterEach(() => {
    resetContextLimitEnv()
  })

  it("uses 1M limit when model cache flag is enabled", async () => {
    //#given
    delete process.env[ANTHROPIC_CONTEXT_ENV_KEY]
    delete process.env[VERTEX_CONTEXT_ENV_KEY]
    const ctx = createContextUsageMockContext(300000)

    //#when
    const usage = await getContextWindowUsage(ctx as never, "ses_1m_flag", {
      anthropicContext1MEnabled: true,
    })

    //#then
    expect(usage?.usagePercentage).toBe(0.3)
    expect(usage?.remainingTokens).toBe(700000)
  })

  it("uses 200K limit when model cache flag is disabled and env vars are unset", async () => {
    //#given
    delete process.env[ANTHROPIC_CONTEXT_ENV_KEY]
    delete process.env[VERTEX_CONTEXT_ENV_KEY]
    const ctx = createContextUsageMockContext(150000)

    //#when
    const usage = await getContextWindowUsage(ctx as never, "ses_default", {
      anthropicContext1MEnabled: false,
    })

    //#then
    expect(usage?.usagePercentage).toBe(0.75)
    expect(usage?.remainingTokens).toBe(50000)
  })

  it("keeps env var fallback when model cache flag is disabled", async () => {
    //#given
    process.env[ANTHROPIC_CONTEXT_ENV_KEY] = "true"
    const ctx = createContextUsageMockContext(300000)

    //#when
    const usage = await getContextWindowUsage(ctx as never, "ses_env_fallback", {
      anthropicContext1MEnabled: false,
    })

    //#then
    expect(usage?.usagePercentage).toBe(0.3)
    expect(usage?.remainingTokens).toBe(700000)
  })

  it("uses model-specific limit for non-anthropic providers when cached", async () => {
    // given
    const modelContextLimitsCache = new Map<string, number>()
    modelContextLimitsCache.set("opencode/kimi-k2.5-free", 262144)
    const ctx = createContextUsageMockContext(180000, {
      providerID: "opencode",
      modelID: "kimi-k2.5-free",
    })

    // when
    const usage = await getContextWindowUsage(ctx as never, "ses_model_limit", {
      anthropicContext1MEnabled: false,
      modelContextLimitsCache,
    })

    // then
    expect(usage?.usagePercentage).toBeCloseTo(180000 / 262144)
    expect(usage?.remainingTokens).toBe(82144)
  })

  describe("#given Anthropic provider with cached context limit and 1M mode enabled", () => {
    describe("#when context usage is resolved", () => {
      it("#then should ignore the cached limit and use the 1M Anthropic limit", async () => {
        // given
        delete process.env[ANTHROPIC_CONTEXT_ENV_KEY]
        delete process.env[VERTEX_CONTEXT_ENV_KEY]

        const modelContextLimitsCache = new Map<string, number>()
        modelContextLimitsCache.set("anthropic/claude-sonnet-4-5", 200000)

        const ctx = createContextUsageMockContext(300000, {
          providerID: "anthropic",
          modelID: "claude-sonnet-4-5",
        })

        // when
        const usage = await getContextWindowUsage(ctx as never, "ses_cached_anthropic_1m", {
          anthropicContext1MEnabled: true,
          modelContextLimitsCache,
        })

        // then
        expect(usage?.usagePercentage).toBe(0.3)
        expect(usage?.remainingTokens).toBe(700000)
      })
    })
  })
})
