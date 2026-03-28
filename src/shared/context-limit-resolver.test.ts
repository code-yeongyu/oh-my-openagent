import process from "node:process"
import { afterEach, describe, expect, it, mock } from "bun:test"

const getModelCapabilitiesMock = mock(() => ({
  contextWindowTokens: undefined as number | undefined,
}))

const { resolveActualContextLimit } = await import("./context-limit-resolver")

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
    getModelCapabilitiesMock.mockReset()
    getModelCapabilitiesMock.mockImplementation(() => ({
      contextWindowTokens: undefined,
    }))
    mock.restore()
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
    }, { getModelCapabilities: getModelCapabilitiesMock })

    expect(actualLimit).toBe(1_000_000)
  })

  it("returns the cached limit for older Anthropic models when 1M mode is disabled", () => {
    // given
    delete process.env[ANTHROPIC_CONTEXT_ENV_KEY]
    delete process.env[VERTEX_CONTEXT_ENV_KEY]
    const modelContextLimitsCache = new Map<string, number>()
    modelContextLimitsCache.set("anthropic/claude-sonnet-4-5", 500_000)

    // when
    const actualLimit = resolveActualContextLimit("anthropic", "claude-sonnet-4-5", {
      anthropicContext1MEnabled: false,
      modelContextLimitsCache,
    }, { getModelCapabilities: getModelCapabilitiesMock })

    // then
    expect(actualLimit).toBe(500_000)
  })

  it("returns null when neither cache nor metadata can resolve an Anthropic limit", () => {
    // given
    delete process.env[ANTHROPIC_CONTEXT_ENV_KEY]
    delete process.env[VERTEX_CONTEXT_ENV_KEY]

    // when
    const actualLimit = resolveActualContextLimit("anthropic", "claude-sonnet-4-5", {
      anthropicContext1MEnabled: false,
    }, { getModelCapabilities: getModelCapabilitiesMock })

    // then
    expect(actualLimit).toBeNull()
  })

  it("uses dynamically discovered limits when cache is empty", () => {
    // given
    delete process.env[ANTHROPIC_CONTEXT_ENV_KEY]
    delete process.env[VERTEX_CONTEXT_ENV_KEY]
    getModelCapabilitiesMock.mockImplementation(({ providerID, modelID }) => ({
      contextWindowTokens:
        providerID === "openai" && modelID === "gpt-5.4"
          ? 1_050_000
          : undefined,
    }))

    // when
    const actualLimit = resolveActualContextLimit("openai", "gpt-5.4", {
      anthropicContext1MEnabled: false,
    }, { getModelCapabilities: getModelCapabilitiesMock })

    // then
    expect(actualLimit).toBe(1_050_000)
  })

  it("uses dynamically discovered Anthropic limits before giving up on unknown limits", () => {
    // given
    delete process.env[ANTHROPIC_CONTEXT_ENV_KEY]
    delete process.env[VERTEX_CONTEXT_ENV_KEY]
    getModelCapabilitiesMock.mockImplementation(({ providerID, modelID }) => ({
      contextWindowTokens:
        providerID === "anthropic" && modelID === "claude-sonnet-4-5"
          ? 500_000
          : undefined,
    }))

    // when
    const actualLimit = resolveActualContextLimit("anthropic", "claude-sonnet-4-5", {
      anthropicContext1MEnabled: false,
    }, { getModelCapabilities: getModelCapabilitiesMock })

    // then
    expect(actualLimit).toBe(500_000)
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
    }, { getModelCapabilities: getModelCapabilitiesMock })

    // then — explicit 1M flag overrides the narrower cached limit
    expect(actualLimit).toBe(1_000_000)
  })

  it("uses provider-level minimum limits without hardcoding model IDs", () => {
    // given
    delete process.env[ANTHROPIC_CONTEXT_ENV_KEY]
    delete process.env[VERTEX_CONTEXT_ENV_KEY]
    const providerContextLimitMinimumsCache = new Map<string, number>()
    providerContextLimitMinimumsCache.set("custom-proxy", 750_000)

    // when
    const actualLimit = resolveActualContextLimit("custom-proxy", "whatever-latest", {
      providerContextLimitMinimumsCache,
    }, { getModelCapabilities: getModelCapabilitiesMock })

    // then
    expect(actualLimit).toBe(750_000)
  })

  it("keeps legacy Anthropic provider aliases compatible with explicit 1M mode", () => {
    // given
    process.env[ANTHROPIC_CONTEXT_ENV_KEY] = "true"
    delete process.env[VERTEX_CONTEXT_ENV_KEY]

    // when
    const actualLimit = resolveActualContextLimit(
      "aws-bedrock-anthropic",
      "claude-sonnet-4-5",
      { anthropicContext1MEnabled: false },
      { getModelCapabilities: getModelCapabilitiesMock },
    )

    // then
    expect(actualLimit).toBe(1_000_000)
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
    }, { getModelCapabilities: getModelCapabilitiesMock })

    // then
    expect(actualLimit).toBe(1_000_000)
  })

  it("supports Anthropic alias model IDs when the cached limit already knows they are 1M", () => {
    // given
    delete process.env[ANTHROPIC_CONTEXT_ENV_KEY]
    delete process.env[VERTEX_CONTEXT_ENV_KEY]
    const modelContextLimitsCache = new Map<string, number>()
    modelContextLimitsCache.set("anthropic/claude-opus", 1_000_000)
    modelContextLimitsCache.set("anthropic/claude-sonnet", 1_000_000)

    // when
    const opusLimit = resolveActualContextLimit("anthropic", "claude-opus", {
      anthropicContext1MEnabled: false,
      modelContextLimitsCache,
    }, { getModelCapabilities: getModelCapabilitiesMock })
    const sonnetLimit = resolveActualContextLimit("anthropic", "claude-sonnet", {
      anthropicContext1MEnabled: false,
      modelContextLimitsCache,
    }, { getModelCapabilities: getModelCapabilitiesMock })

    // then
    expect(opusLimit).toBe(1_000_000)
    expect(sonnetLimit).toBe(1_000_000)
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
    }, { getModelCapabilities: getModelCapabilitiesMock })

    // then
    expect(actualLimit).toBe(500_000)
  })

  it("returns cached limits for older Anthropic models with suffixed IDs", () => {
    // given
    delete process.env[ANTHROPIC_CONTEXT_ENV_KEY]
    delete process.env[VERTEX_CONTEXT_ENV_KEY]
    const modelContextLimitsCache = new Map<string, number>()
    modelContextLimitsCache.set("anthropic/claude-sonnet-4-5-high", 500_000)

    // when
    const actualLimit = resolveActualContextLimit("anthropic", "claude-sonnet-4-5-high", {
      anthropicContext1MEnabled: false,
      modelContextLimitsCache,
    }, { getModelCapabilities: getModelCapabilitiesMock })

    // then
    expect(actualLimit).toBe(500_000)
  })

  it("returns null for non-Anthropic providers when neither cache nor metadata knows the limit", () => {
    // given
    delete process.env[ANTHROPIC_CONTEXT_ENV_KEY]
    delete process.env[VERTEX_CONTEXT_ENV_KEY]

    // when
    const actualLimit = resolveActualContextLimit("openai", "gpt-5", {
      anthropicContext1MEnabled: false,
    }, { getModelCapabilities: getModelCapabilitiesMock })

    // then
    expect(actualLimit).toBeNull()
  })
})
