import { describe, expect, it } from "bun:test"

import { parseModelSuggestion } from "./parse-model-suggestion"

describe("parseModelSuggestion", () => {
  it("extracts suggestions from structured Anthropic ProviderModelNotFoundError", () => {
    const error = {
      name: "ProviderModelNotFoundError",
      data: {
        providerID: "anthropic",
        modelID: "claude-sonet-4",
        suggestions: ["claude-sonnet-4", "claude-sonnet-4-6"],
      },
    }

    expect(parseModelSuggestion(error)).toEqual({
      providerID: "anthropic",
      modelID: "claude-sonet-4",
      suggestion: "claude-sonnet-4",
    })
  })

  it("extracts suggestions from nested OpenAI errors", () => {
    const error = {
      data: {
        name: "ProviderModelNotFoundError",
        data: {
          providerID: "openai",
          modelID: "gpt-5",
          suggestions: ["gpt-5.4"],
        },
      },
    }

    expect(parseModelSuggestion(error)).toEqual({
      providerID: "openai",
      modelID: "gpt-5",
      suggestion: "gpt-5.4",
    })
  })

  it("extracts suggestions from Bedrock-style model-not-found messages", () => {
    const error = new Error(
      "Model not found: aws-bedrock-anthropic/claude-sonet-4. Did you mean: claude-sonnet-4, claude-sonnet-4-6?",
    )

    expect(parseModelSuggestion(error)).toEqual({
      providerID: "aws-bedrock-anthropic",
      modelID: "claude-sonet-4",
      suggestion: "claude-sonnet-4",
    })
  })

  it("extracts suggestions from plain string message payloads", () => {
    const error = "Model not found: openai/gtp-5. Did you mean: gpt-5?"

    expect(parseModelSuggestion(error)).toEqual({
      providerID: "openai",
      modelID: "gtp-5",
      suggestion: "gpt-5",
    })
  })

  it("returns null for unrelated errors", () => {
    expect(parseModelSuggestion(new Error("Connection timeout"))).toBeNull()
    expect(parseModelSuggestion(null)).toBeNull()
  })
})
