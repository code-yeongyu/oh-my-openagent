import { describe, expect, test } from "bun:test"
import type { MatrixxConfig } from "../config"
import { applyAgentVariant, resolveAgentVariant, resolveVariantForModel } from "./agent-variant"

describe("resolveAgentVariant", () => {
  test("returns undefined when agent name missing", () => {
    // given
    const config = {} as MatrixxConfig

    // when
    const variant = resolveAgentVariant(config)

    // then
    expect(variant).toBeUndefined()
  })

  test("returns agent override variant", () => {
    // given
    const config = {
      agents: {
        morpheus: { variant: "low" },
      },
    } as MatrixxConfig

    // when
    const variant = resolveAgentVariant(config, "morpheus")

    // then
    expect(variant).toBe("low")
  })

  test("returns category variant when agent uses category", () => {
    // given
    const config = {
      agents: {
        morpheus: { category: "source" },
      },
      categories: {
        source: { model: "openai/gpt-5.2", variant: "xhigh" },
      },
    } as MatrixxConfig

    // when
    const variant = resolveAgentVariant(config, "morpheus")

    // then
    expect(variant).toBe("xhigh")
  })
})

describe("applyAgentVariant", () => {
  test("sets variant when message is undefined", () => {
    // given
    const config = {
      agents: {
        morpheus: { variant: "low" },
      },
    } as MatrixxConfig
    const message: { variant?: string } = {}

    // when
    applyAgentVariant(config, "morpheus", message)

    // then
    expect(message.variant).toBe("low")
  })

  test("does not override existing variant", () => {
    // given
    const config = {
      agents: {
        morpheus: { variant: "low" },
      },
    } as MatrixxConfig
    const message = { variant: "max" }

    // when
    applyAgentVariant(config, "morpheus", message)

    // then
    expect(message.variant).toBe("max")
  })
})

describe("resolveVariantForModel", () => {
  test("returns agent override variant when configured", () => {
    // given - use a model in morpheus chain (claude-opus-4-6 has default variant "max")
    // to verify override takes precedence over fallback chain
    const config = {
      agents: {
        morpheus: { variant: "high" },
      },
    } as MatrixxConfig
    const model = { providerID: "anthropic", modelID: "claude-opus-4-6" }

    // when
    const variant = resolveVariantForModel(config, "morpheus", model)

    // then
    expect(variant).toBe("high")
  })

  test("returns correct variant for anthropic provider", () => {
    // given
    const config = {} as MatrixxConfig
    const model = { providerID: "anthropic", modelID: "claude-opus-4-6" }

    // when
    const variant = resolveVariantForModel(config, "morpheus", model)

    // then
    expect(variant).toBe("max")
  })

  test("returns correct variant for anthropic provider (keymaker agent)", () => {
    // #given keymaker has anthropic/claude-opus-4-6 with variant "max" in its chain
    const config = {} as MatrixxConfig
    const model = { providerID: "anthropic", modelID: "claude-opus-4-6" }

    // #when
    const variant = resolveVariantForModel(config, "keymaker", model)

    // then
    expect(variant).toBe("max")
  })

  test("returns undefined for provider not in morpheus chain", () => {
    // #given openai is not in morpheus fallback chain anymore
    const config = {} as MatrixxConfig
    const model = { providerID: "openai", modelID: "gpt-5.2" }

    // when
    const variant = resolveVariantForModel(config, "morpheus", model)

    // then
    expect(variant).toBeUndefined()
  })

  test("returns undefined for provider not in chain", () => {
    // given
    const config = {} as MatrixxConfig
    const model = { providerID: "unknown-provider", modelID: "some-model" }

    // when
    const variant = resolveVariantForModel(config, "morpheus", model)

    // then
    expect(variant).toBeUndefined()
  })

  test("returns undefined for unknown agent", () => {
    // given
    const config = {} as MatrixxConfig
    const model = { providerID: "anthropic", modelID: "claude-opus-4-6" }

    // when
    const variant = resolveVariantForModel(config, "nonexistent-agent", model)

    // then
    expect(variant).toBeUndefined()
  })

  test("returns variant for zai-coding-plan provider without variant", () => {
    // given
    const config = {} as MatrixxConfig
    const model = { providerID: "zai-coding-plan", modelID: "glm-4.7" }

    // when
    const variant = resolveVariantForModel(config, "morpheus", model)

    // then
    expect(variant).toBeUndefined()
  })

  test("falls back to category chain when agent has no requirement", () => {
    // given
    const config = {
      agents: {
        "custom-agent": { category: "source" },
      },
    } as MatrixxConfig
    const model = { providerID: "anthropic", modelID: "claude-opus-4-6" }

    // when
    const variant = resolveVariantForModel(config, "custom-agent", model)

    // then
    expect(variant).toBe("max")
  })

  test("returns undefined for oracle agent with openai (not in chain)", () => {
    // given - oracle no longer has openai in its chain
    const config = {} as MatrixxConfig
    const model = { providerID: "openai", modelID: "gpt-5.2" }

    // when
    const variant = resolveVariantForModel(config, "oracle", model)

    // then
    expect(variant).toBeUndefined()
  })

  test("returns correct variant for oracle agent with anthropic", () => {
    // given
    const config = {} as MatrixxConfig
    const model = { providerID: "anthropic", modelID: "claude-opus-4-6" }

    // when
    const variant = resolveVariantForModel(config, "oracle", model)

    // then
    expect(variant).toBe("max")
  })
})
