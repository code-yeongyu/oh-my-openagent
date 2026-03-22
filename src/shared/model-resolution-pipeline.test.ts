declare const require: (name: string) => any
const { afterEach, describe, expect, spyOn, test } = require("bun:test")
import { resolveModelPipeline } from "./model-resolution-pipeline"
import * as connectedProvidersCache from "./connected-providers-cache"

describe("resolveModelPipeline", () => {
  let readConnectedProvidersSpy: ReturnType<typeof spyOn> | undefined

  afterEach(() => {
    readConnectedProvidersSpy?.mockRestore()
  })

  test("does not return unused explicit user config metadata in override result", () => {
    // given
    const result = resolveModelPipeline({
      intent: {
        userModel: "openai/gpt-5.3-codex",
      },
      constraints: {
        availableModels: new Set<string>(),
      },
    })

    // when
    const hasExplicitUserConfigField = result
      ? Object.prototype.hasOwnProperty.call(result, "explicitUserConfig")
      : false

    // then
    expect(result).toEqual({ model: "openai/gpt-5.3-codex", provenance: "override" })
    expect(hasExplicitUserConfigField).toBe(false)
  })

  test("resolves category default with multi-slash model ID when first segment is not a connected provider", () => {
    readConnectedProvidersSpy = spyOn(connectedProvidersCache, "readConnectedProvidersCache").mockReturnValue(["nvidia"])

    const result = resolveModelPipeline({
      intent: {
        categoryDefaultModel: "aws/anthropic/bedrock-claude-opus-4-6",
      },
      constraints: {
        availableModels: new Set(["nvidia/aws/anthropic/bedrock-claude-opus-4-6"]),
      },
    })

    expect(result).toEqual({
      model: "nvidia/aws/anthropic/bedrock-claude-opus-4-6",
      provenance: "category-default",
      attempted: ["aws/anthropic/bedrock-claude-opus-4-6"],
    })
  })

  test("resolves user fallback model with multi-slash model ID when first segment is not a connected provider", () => {
    readConnectedProvidersSpy = spyOn(connectedProvidersCache, "readConnectedProvidersCache").mockReturnValue(["nvidia"])

    const result = resolveModelPipeline({
      intent: {
        userFallbackModels: ["aws/anthropic/bedrock-claude-opus-4-6"],
      },
      constraints: {
        availableModels: new Set(["nvidia/aws/anthropic/bedrock-claude-opus-4-6"]),
      },
    })

    expect(result).toEqual({
      model: "nvidia/aws/anthropic/bedrock-claude-opus-4-6",
      provenance: "provider-fallback",
      attempted: ["aws/anthropic/bedrock-claude-opus-4-6"],
    })
  })
})
