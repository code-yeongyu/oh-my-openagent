import { describe, it, expect, mock } from "bun:test"
import { parseModelSuggestion, promptWithModelSuggestionRetry } from "./model-suggestion-retry"

describe("parseModelSuggestion", () => {
  describe("structured NamedError format", () => {
    it("should extract suggestion from ProviderModelNotFoundError", () => {
      //#given a structured NamedError with suggestions
      const error = {
        name: "ProviderModelNotFoundError",
        data: {
          providerID: "anthropic",
          modelID: "claude-sonet-4",
          suggestions: ["claude-sonnet-4", "claude-sonnet-4-5"],
        },
      }

      //#when parsing the error
      const result = parseModelSuggestion(error)

      //#then should return the first suggestion
      expect(result).toEqual({
        providerID: "anthropic",
        modelID: "claude-sonet-4",
        suggestion: "claude-sonnet-4",
      })
    })

    it("should return null when suggestions array is empty", () => {
      //#given a NamedError with empty suggestions
      const error = {
        name: "ProviderModelNotFoundError",
        data: {
          providerID: "anthropic",
          modelID: "claude-sonet-4",
          suggestions: [],
        },
      }

      //#when parsing the error
      const result = parseModelSuggestion(error)

      //#then should return null
      expect(result).toBeNull()
    })

    it("should return null when suggestions field is missing", () => {
      //#given a NamedError without suggestions
      const error = {
        name: "ProviderModelNotFoundError",
        data: {
          providerID: "anthropic",
          modelID: "claude-sonet-4",
        },
      }

      //#when parsing the error
      const result = parseModelSuggestion(error)

      //#then should return null
      expect(result).toBeNull()
    })
  })

  describe("nested error format", () => {
    it("should extract suggestion from nested data.error", () => {
      //#given an error with nested NamedError in data field
      const error = {
        data: {
          name: "ProviderModelNotFoundError",
          data: {
            providerID: "openai",
            modelID: "gpt-5",
            suggestions: ["gpt-5.2"],
          },
        },
      }

      //#when parsing the error
      const result = parseModelSuggestion(error)

      //#then should extract from nested structure
      expect(result).toEqual({
        providerID: "openai",
        modelID: "gpt-5",
        suggestion: "gpt-5.2",
      })
    })

    it("should extract suggestion from nested error field", () => {
      //#given an error with nested NamedError in error field
      const error = {
        error: {
          name: "ProviderModelNotFoundError",
          data: {
            providerID: "google",
            modelID: "gemini-3-flsh",
            suggestions: ["gemini-3-flash"],
          },
        },
      }

      //#when parsing the error
      const result = parseModelSuggestion(error)

      //#then should extract from nested error field
      expect(result).toEqual({
        providerID: "google",
        modelID: "gemini-3-flsh",
        suggestion: "gemini-3-flash",
      })
    })
  })

  describe("string message format", () => {
    it("should parse suggestion from error message string", () => {
      //#given an Error with model-not-found message and suggestion
      const error = new Error(
        "Model not found: anthropic/claude-sonet-4. Did you mean: claude-sonnet-4, claude-sonnet-4-5?"
      )

      //#when parsing the error
      const result = parseModelSuggestion(error)

      //#then should extract from message string
      expect(result).toEqual({
        providerID: "anthropic",
        modelID: "claude-sonet-4",
        suggestion: "claude-sonnet-4",
      })
    })

    it("should parse from plain string error", () => {
      //#given a plain string error message
      const error =
        "Model not found: openai/gtp-5. Did you mean: gpt-5?"

      //#when parsing the error
      const result = parseModelSuggestion(error)

      //#then should extract from string
      expect(result).toEqual({
        providerID: "openai",
        modelID: "gtp-5",
        suggestion: "gpt-5",
      })
    })

    it("should parse from object with message property", () => {
      //#given an object with message property
      const error = {
        message: "Model not found: google/gemini-3-flsh. Did you mean: gemini-3-flash?",
      }

      //#when parsing the error
      const result = parseModelSuggestion(error)

      //#then should extract from message property
      expect(result).toEqual({
        providerID: "google",
        modelID: "gemini-3-flsh",
        suggestion: "gemini-3-flash",
      })
    })

    it("should return null when message has no suggestion", () => {
      //#given an error without Did you mean
      const error = new Error("Model not found: anthropic/nonexistent.")

      //#when parsing the error
      const result = parseModelSuggestion(error)

      //#then should return null
      expect(result).toBeNull()
    })
  })

  describe("edge cases", () => {
    it("should return null for null error", () => {
      //#given null
      //#when parsing
      const result = parseModelSuggestion(null)
      //#then should return null
      expect(result).toBeNull()
    })

    it("should return null for undefined error", () => {
      //#given undefined
      //#when parsing
      const result = parseModelSuggestion(undefined)
      //#then should return null
      expect(result).toBeNull()
    })

    it("should return null for unrelated error", () => {
      //#given an unrelated error
      const error = new Error("Connection timeout")
      //#when parsing
      const result = parseModelSuggestion(error)
      //#then should return null
      expect(result).toBeNull()
    })

    it("should return null for empty object", () => {
      //#given empty object
      //#when parsing
      const result = parseModelSuggestion({})
      //#then should return null
      expect(result).toBeNull()
    })
  })
})

describe("promptWithModelSuggestionRetry", () => {
  it("should succeed on first try without retry", async () => {
    //#given a client where prompt succeeds
    const promptMock = mock(() => Promise.resolve())
    const client = { session: { prompt: promptMock } }

    //#when calling promptWithModelSuggestionRetry
    await promptWithModelSuggestionRetry(client as any, {
      path: { id: "session-1" },
      body: {
        parts: [{ type: "text", text: "hello" }],
        model: { providerID: "anthropic", modelID: "claude-sonnet-4" },
      },
    })

    //#then should call prompt exactly once
    expect(promptMock).toHaveBeenCalledTimes(1)
  })

  it("should retry with suggestion on model-not-found error", async () => {
    //#given a client that fails first with model-not-found, then succeeds
    const promptMock = mock()
      .mockRejectedValueOnce({
        name: "ProviderModelNotFoundError",
        data: {
          providerID: "anthropic",
          modelID: "claude-sonet-4",
          suggestions: ["claude-sonnet-4"],
        },
      })
      .mockResolvedValueOnce(undefined)
    const client = { session: { prompt: promptMock } }

    //#when calling promptWithModelSuggestionRetry
    await promptWithModelSuggestionRetry(client as any, {
      path: { id: "session-1" },
      body: {
        agent: "explore",
        parts: [{ type: "text", text: "hello" }],
        model: { providerID: "anthropic", modelID: "claude-sonet-4" },
      },
    })

    //#then should call prompt twice - first with original, then with suggestion
    expect(promptMock).toHaveBeenCalledTimes(2)
    const retryCall = promptMock.mock.calls[1][0]
    expect(retryCall.body.model).toEqual({
      providerID: "anthropic",
      modelID: "claude-sonnet-4",
    })
  })

  it("should throw original error when no suggestion available", async () => {
    //#given a client that fails with a non-model-not-found error
    const originalError = new Error("Connection refused")
    const promptMock = mock().mockRejectedValueOnce(originalError)
    const client = { session: { prompt: promptMock } }

    //#when calling promptWithModelSuggestionRetry
    //#then should throw the original error
    await expect(
      promptWithModelSuggestionRetry(client as any, {
        path: { id: "session-1" },
        body: {
          parts: [{ type: "text", text: "hello" }],
          model: { providerID: "anthropic", modelID: "claude-sonnet-4" },
        },
      })
    ).rejects.toThrow("Connection refused")

    expect(promptMock).toHaveBeenCalledTimes(1)
  })

  it("should throw original error when retry also fails", async () => {
    //#given a client that fails with model-not-found, retry also fails
    const modelNotFoundError = {
      name: "ProviderModelNotFoundError",
      data: {
        providerID: "anthropic",
        modelID: "claude-sonet-4",
        suggestions: ["claude-sonnet-4"],
      },
    }
    const retryError = new Error("Still not found")
    const promptMock = mock()
      .mockRejectedValueOnce(modelNotFoundError)
      .mockRejectedValueOnce(retryError)
    const client = { session: { prompt: promptMock } }

    //#when calling promptWithModelSuggestionRetry
    //#then should throw the retry error (not the original)
    await expect(
      promptWithModelSuggestionRetry(client as any, {
        path: { id: "session-1" },
        body: {
          parts: [{ type: "text", text: "hello" }],
          model: { providerID: "anthropic", modelID: "claude-sonet-4" },
        },
      })
    ).rejects.toThrow("Still not found")

    expect(promptMock).toHaveBeenCalledTimes(2)
  })

  it("should preserve other body fields during retry", async () => {
    //#given a client that fails first with model-not-found
    const promptMock = mock()
      .mockRejectedValueOnce({
        name: "ProviderModelNotFoundError",
        data: {
          providerID: "anthropic",
          modelID: "claude-sonet-4",
          suggestions: ["claude-sonnet-4"],
        },
      })
      .mockResolvedValueOnce(undefined)
    const client = { session: { prompt: promptMock } }

    //#when calling with additional body fields
    await promptWithModelSuggestionRetry(client as any, {
      path: { id: "session-1" },
      body: {
        agent: "explore",
        system: "You are a helpful agent",
        tools: { task: false },
        parts: [{ type: "text", text: "hello" }],
        model: { providerID: "anthropic", modelID: "claude-sonet-4" },
        variant: "max",
      },
    })

    //#then retry call should preserve all fields except corrected model
    const retryCall = promptMock.mock.calls[1][0]
    expect(retryCall.body.agent).toBe("explore")
    expect(retryCall.body.system).toBe("You are a helpful agent")
    expect(retryCall.body.tools).toEqual({ task: false })
    expect(retryCall.body.variant).toBe("max")
    expect(retryCall.body.model).toEqual({
      providerID: "anthropic",
      modelID: "claude-sonnet-4",
    })
  })

  it("should handle string error message with suggestion", async () => {
    //#given a client that fails with a string error containing suggestion
    const promptMock = mock()
      .mockRejectedValueOnce(
        new Error("Model not found: anthropic/claude-sonet-4. Did you mean: claude-sonnet-4?")
      )
      .mockResolvedValueOnce(undefined)
    const client = { session: { prompt: promptMock } }

    //#when calling promptWithModelSuggestionRetry
    await promptWithModelSuggestionRetry(client as any, {
      path: { id: "session-1" },
      body: {
        parts: [{ type: "text", text: "hello" }],
        model: { providerID: "anthropic", modelID: "claude-sonet-4" },
      },
    })

    //#then should retry with suggested model
    expect(promptMock).toHaveBeenCalledTimes(2)
    const retryCall = promptMock.mock.calls[1][0]
    expect(retryCall.body.model.modelID).toBe("claude-sonnet-4")
  })

  it("should not retry when no model in original request", async () => {
    //#given a client that fails with model-not-found but original has no model param
    const modelNotFoundError = new Error(
      "Model not found: anthropic/claude-sonet-4. Did you mean: claude-sonnet-4?"
    )
    const promptMock = mock().mockRejectedValueOnce(modelNotFoundError)
    const client = { session: { prompt: promptMock } }

    //#when calling without model in body
    //#then should throw without retrying
    await expect(
      promptWithModelSuggestionRetry(client as any, {
        path: { id: "session-1" },
        body: {
          parts: [{ type: "text", text: "hello" }],
        },
      })
    ).rejects.toThrow()

    expect(promptMock).toHaveBeenCalledTimes(1)
  })
})
