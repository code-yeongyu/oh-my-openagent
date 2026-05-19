import { afterEach, describe, it, expect, mock } from "bun:test"
import { dispatchInternalPrompt, releaseAllPromptAsyncReservationsForTesting } from "./prompt-async-gate"
import { parseModelSuggestion, promptWithModelSuggestionRetry, promptSyncWithModelSuggestionRetry } from "./model-suggestion-retry"
import { unsafeTestValue } from "../../test-support/unsafe-test-value"

describe("parseModelSuggestion", () => {
  describe("structured NamedError format", () => {
    it("should extract suggestion from ProviderModelNotFoundError", () => {
      // given a structured NamedError with suggestions
      const error = {
        name: "ProviderModelNotFoundError",
        data: {
          providerID: "anthropic",
          modelID: "claude-sonet-4",
          suggestions: ["claude-sonnet-4", "claude-sonnet-4-6"],
        },
      }

      // when parsing the error
      const result = parseModelSuggestion(error)

      // then should return the first suggestion
      expect(result).toEqual({
        providerID: "anthropic",
        modelID: "claude-sonet-4",
        suggestion: "claude-sonnet-4",
      })
    })

    it("should return null when suggestions array is empty", () => {
      // given a NamedError with empty suggestions
      const error = {
        name: "ProviderModelNotFoundError",
        data: {
          providerID: "anthropic",
          modelID: "claude-sonet-4",
          suggestions: [],
        },
      }

      // when parsing the error
      const result = parseModelSuggestion(error)

      // then should return null
      expect(result).toBeNull()
    })

    it("should return null when suggestions field is missing", () => {
      // given a NamedError without suggestions
      const error = {
        name: "ProviderModelNotFoundError",
        data: {
          providerID: "anthropic",
          modelID: "claude-sonet-4",
        },
      }

      // when parsing the error
      const result = parseModelSuggestion(error)

      // then should return null
      expect(result).toBeNull()
    })
  })

  describe("nested error format", () => {
    it("should extract suggestion from nested data.error", () => {
      // given an error with nested NamedError in data field
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

      // when parsing the error
      const result = parseModelSuggestion(error)

      // then should extract from nested structure
      expect(result).toEqual({
        providerID: "openai",
        modelID: "gpt-5",
        suggestion: "gpt-5.4",
      })
    })

    it("should extract suggestion from nested error field", () => {
      // given an error with nested NamedError in error field
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

      // when parsing the error
      const result = parseModelSuggestion(error)

      // then should extract from nested error field
      expect(result).toEqual({
        providerID: "google",
        modelID: "gemini-3-flsh",
        suggestion: "gemini-3-flash",
      })
    })
  })

  describe("string message format", () => {
    it("should parse suggestion from error message string", () => {
      // given an Error with model-not-found message and suggestion
      const error = new Error(
        "Model not found: anthropic/claude-sonet-4. Did you mean: claude-sonnet-4, claude-sonnet-4-6?"
      )

      // when parsing the error
      const result = parseModelSuggestion(error)

      // then should extract from message string
      expect(result).toEqual({
        providerID: "anthropic",
        modelID: "claude-sonet-4",
        suggestion: "claude-sonnet-4",
      })
    })

    it("should parse from plain string error", () => {
      // given a plain string error message
      const error =
        "Model not found: openai/gtp-5. Did you mean: gpt-5?"

      // when parsing the error
      const result = parseModelSuggestion(error)

      // then should extract from string
      expect(result).toEqual({
        providerID: "openai",
        modelID: "gtp-5",
        suggestion: "gpt-5",
      })
    })

    it("should parse from object with message property", () => {
      // given an object with message property
      const error = {
        message: "Model not found: google/gemini-3-flsh. Did you mean: gemini-3-flash?",
      }

      // when parsing the error
      const result = parseModelSuggestion(error)

      // then should extract from message property
      expect(result).toEqual({
        providerID: "google",
        modelID: "gemini-3-flsh",
        suggestion: "gemini-3-flash",
      })
    })

    it("should return null when message has no suggestion", () => {
      // given an error without Did you mean
      const error = new Error("Model not found: anthropic/nonexistent.")

      // when parsing the error
      const result = parseModelSuggestion(error)

      // then should return null
      expect(result).toBeNull()
    })
  })

  describe("edge cases", () => {
    it("should return null for null error", () => {
      // given null
      // when parsing
      const result = parseModelSuggestion(null)
      // then should return null
      expect(result).toBeNull()
    })

    it("should return null for undefined error", () => {
      // given undefined
      // when parsing
      const result = parseModelSuggestion(undefined)
      // then should return null
      expect(result).toBeNull()
    })

    it("should return null for unrelated error", () => {
      // given an unrelated error
      const error = new Error("Connection timeout")
      // when parsing
      const result = parseModelSuggestion(error)
      // then should return null
      expect(result).toBeNull()
    })

    it("should return null for empty object", () => {
      // given empty object
      // when parsing
      const result = parseModelSuggestion({})
      // then should return null
      expect(result).toBeNull()
    })
  })
})

describe("promptWithModelSuggestionRetry", () => {
  afterEach(() => {
    // then
    releaseAllPromptAsyncReservationsForTesting()
  })

  it("should succeed on first try without retry", async () => {
    // given a client where promptAsync succeeds
    const promptMock = mock(() => Promise.resolve())
    const client = { session: { promptAsync: promptMock } }

    // when calling promptWithModelSuggestionRetry
    await promptWithModelSuggestionRetry(unsafeTestValue(client), {
      path: { id: "session-1" },
      body: {
        parts: [{ type: "text", text: "hello" }],
        model: { providerID: "anthropic", modelID: "claude-sonnet-4" },
      },
    })

    // then should call promptAsync exactly once
    expect(promptMock).toHaveBeenCalledTimes(1)
  })

  it("should coalesce concurrent promptAsync retries for the same session after one dispatch is reserved", async () => {
    // given two callers racing to send into one session
    let releasePrompt: (() => void) | undefined
    const promptGate = new Promise<void>((resolve) => {
      releasePrompt = resolve
    })
    const promptMock = mock(async () => {
      await promptGate
    })
    const client = {
      session: {
        status: async () => ({ data: { "session-dup": { type: "idle" } } }),
        promptAsync: promptMock,
      },
    }
    const args = {
      path: { id: "session-dup" },
      body: {
        parts: [{ type: "text", text: "hello" }],
        model: { providerID: "anthropic", modelID: "claude-sonnet-4" },
      },
    }

    // when both callers try to prompt the same session before the first dispatch settles
    const first = promptWithModelSuggestionRetry(unsafeTestValue(client), args)
    await Promise.resolve()
    const second = promptWithModelSuggestionRetry(unsafeTestValue(client), args)
    releasePrompt?.()
    const results = await Promise.allSettled([first, second])

    // then only the reserved dispatch is sent to OpenCode
    expect(promptMock).toHaveBeenCalledTimes(1)
    expect(results[0]?.status).toBe("fulfilled")
    expect(results[1]?.status).toBe("fulfilled")
  })

  it("#given promptAsync retry just dispatched #when the same session is prompted again immediately #then the second caller is coalesced by the queue", async () => {
    // given
    const promptMock = mock(async () => undefined)
    const client = {
      session: {
        promptAsync: promptMock,
      },
    }
    const args = {
      path: { id: "session-post-dispatch-hold" },
      body: {
        parts: [{ type: "text", text: "hello" }],
        model: { providerID: "anthropic", modelID: "claude-sonnet-4" },
      },
    }

    // when
    await promptWithModelSuggestionRetry(unsafeTestValue(client), args)
    await promptWithModelSuggestionRetry(unsafeTestValue(client), args)

    // then
    expect(promptMock).toHaveBeenCalledTimes(1)
  })

  it("#given same-source retry observes a peer reservation #when it coalesces #then a different prompt remains queued behind the hold", async () => {
    // given
    const promptMock = mock(async () => undefined)
    const client = {
      session: {
        promptAsync: promptMock,
      },
    }
    const args = {
      path: { id: "session-peer-reservation" },
      body: {
        parts: [{ type: "text", text: "hello" }],
        model: { providerID: "anthropic", modelID: "claude-sonnet-4" },
      },
    }

    // when
    await promptWithModelSuggestionRetry(unsafeTestValue(client), args)
    await promptWithModelSuggestionRetry(unsafeTestValue(client), args)
    const third = await dispatchInternalPrompt({
      mode: "async",
      client,
      sessionID: "session-peer-reservation",
      input: args,
      source: "test:third",
      settleMs: 0,
      postDispatchHoldMs: 0,
    })

    // then
    expect(third).toEqual({ status: "queued", queuedBy: "model-suggestion-retry", position: 1 })
    expect(promptMock).toHaveBeenCalledTimes(1)
  })

  it("should throw error from promptAsync directly on model-not-found error", async () => {
    // given a client that fails with model-not-found error
    const promptMock = mock().mockRejectedValueOnce({
      name: "ProviderModelNotFoundError",
      data: {
        providerID: "anthropic",
        modelID: "claude-sonet-4",
        suggestions: ["claude-sonnet-4"],
      },
    })
    const client = { session: { promptAsync: promptMock } }

    // when calling promptWithModelSuggestionRetry
    // then should throw the error without retrying
    await expect(
      promptWithModelSuggestionRetry(unsafeTestValue(client), {
        path: { id: "session-1" },
        body: {
          agent: "explore",
          parts: [{ type: "text", text: "hello" }],
          model: { providerID: "anthropic", modelID: "claude-sonet-4" },
        },
      })
    ).rejects.toThrow()

    // and should call promptAsync only once
    expect(promptMock).toHaveBeenCalledTimes(1)
  })

  it("should throw original error when no suggestion available", async () => {
    // given a client that fails with a non-model-not-found error
    const originalError = new Error("Connection refused")
    const promptMock = mock().mockRejectedValueOnce(originalError)
    const client = { session: { promptAsync: promptMock } }

    // when calling promptWithModelSuggestionRetry
    // then should throw the original error
    await expect(
      promptWithModelSuggestionRetry(unsafeTestValue(client), {
        path: { id: "session-1" },
        body: {
          parts: [{ type: "text", text: "hello" }],
          model: { providerID: "anthropic", modelID: "claude-sonnet-4" },
        },
      })
    ).rejects.toThrow("Connection refused")

    expect(promptMock).toHaveBeenCalledTimes(1)
  })

  it("should throw error from promptAsync directly", async () => {
    // given a client that fails with an error
    const error = new Error("Still not found")
    const promptMock = mock().mockRejectedValueOnce(error)
    const client = { session: { promptAsync: promptMock } }

    // when calling promptWithModelSuggestionRetry
    // then should throw the error
    await expect(
      promptWithModelSuggestionRetry(unsafeTestValue(client), {
        path: { id: "session-1" },
        body: {
          parts: [{ type: "text", text: "hello" }],
          model: { providerID: "anthropic", modelID: "claude-sonnet-4" },
        },
      })
    ).rejects.toThrow("Still not found")

    // and should call promptAsync only once
    expect(promptMock).toHaveBeenCalledTimes(1)
  })

  it("#given promptAsync throws after dispatch was attempted #when caller observes the error #then the post-dispatch hold remains reserved", async () => {
    // given
    const promptMock = mock().mockRejectedValueOnce(new Error("JSON Parse error: Unexpected EOF"))
    const client = { session: { promptAsync: promptMock } }
    const args = {
      path: { id: "session-failed-async-hold" },
      body: {
        parts: [{ type: "text", text: "hello" }],
        model: { providerID: "anthropic", modelID: "claude-sonnet-4" },
      },
    }

    // when
    await expect(
      promptWithModelSuggestionRetry(unsafeTestValue(client), args)
    ).rejects.toThrow("Unexpected EOF")
    const second = await dispatchInternalPrompt({
      mode: "async",
      client,
      sessionID: "session-failed-async-hold",
      input: args,
      source: "test:after-failed-async",
      settleMs: 0,
      postDispatchHoldMs: 0,
    })

    // then
    expect(second).toEqual({ status: "queued", queuedBy: "model-suggestion-retry", position: 1 })
    expect(promptMock).toHaveBeenCalledTimes(1)
  })

  it("#given promptAsync rejects before acceptance with an agent lookup error #when retried immediately #then the reservation is released", async () => {
    // given
    const promptMock = mock()
      .mockRejectedValueOnce(new Error("Agent not found: missing-agent"))
      .mockResolvedValueOnce(undefined)
    const client = { session: { promptAsync: promptMock } }
    const args = {
      path: { id: "session-agent-preaccept-failure" },
      body: {
        agent: "missing-agent",
        parts: [{ type: "text", text: "hello" }],
      },
    }

    // when
    await expect(
      promptWithModelSuggestionRetry(unsafeTestValue(client), args)
    ).rejects.toThrow("Agent not found")
    await promptWithModelSuggestionRetry(unsafeTestValue(client), {
      ...args,
      body: {
        ...args.body,
        agent: "general",
      },
    })

    // then
    expect(promptMock).toHaveBeenCalledTimes(2)
  })

  it("should pass all body fields through to promptAsync", async () => {
    // given a client where promptAsync succeeds
    const promptMock = mock().mockResolvedValueOnce(undefined)
    const client = { session: { promptAsync: promptMock } }

    // when calling with additional body fields
    await promptWithModelSuggestionRetry(unsafeTestValue(client), {
      path: { id: "session-1" },
      body: {
        agent: "explore",
        system: "You are a helpful agent",
        tools: { task: false },
        parts: [{ type: "text", text: "hello" }],
        model: { providerID: "anthropic", modelID: "claude-sonnet-4" },
        variant: "max",
      },
    })

    // then call should pass all fields through unchanged
    const call = promptMock.mock.calls[0][0]
    expect(call.body.agent).toBe("explore")
    expect(call.body.system).toBe("You are a helpful agent")
    expect(call.body.tools).toEqual({ task: false })
    expect(call.body.variant).toBe("max")
    expect(call.body.model).toEqual({
      providerID: "anthropic",
      modelID: "claude-sonnet-4",
    })
  })

  it("should throw string error message from promptAsync", async () => {
    // given a client that fails with a string error
    const promptMock = mock().mockRejectedValueOnce(
      new Error("Model not found: anthropic/claude-sonet-4. Did you mean: claude-sonnet-4?")
    )
    const client = { session: { promptAsync: promptMock } }

    // when calling promptWithModelSuggestionRetry
    // then should throw the error
    await expect(
      promptWithModelSuggestionRetry(unsafeTestValue(client), {
        path: { id: "session-1" },
        body: {
          parts: [{ type: "text", text: "hello" }],
          model: { providerID: "anthropic", modelID: "claude-sonnet-4" },
        },
      })
    ).rejects.toThrow()

    // and should call promptAsync only once
    expect(promptMock).toHaveBeenCalledTimes(1)
  })

  it("should throw error when no model in original request", async () => {
    // given a client that fails with an error
    const modelNotFoundError = new Error(
      "Model not found: anthropic/claude-sonet-4. Did you mean: claude-sonnet-4?"
    )
    const promptMock = mock().mockRejectedValueOnce(modelNotFoundError)
    const client = { session: { promptAsync: promptMock } }

    // when calling without model in body
    // then should throw the error
    await expect(
      promptWithModelSuggestionRetry(unsafeTestValue(client), {
        path: { id: "session-1" },
        body: {
          parts: [{ type: "text", text: "hello" }],
        },
      })
    ).rejects.toThrow()

    // and should call promptAsync only once
    expect(promptMock).toHaveBeenCalledTimes(1)
  })
})

describe("promptSyncWithModelSuggestionRetry", () => {
  it("should use synchronous prompt (not promptAsync)", async () => {
    // given a client with both prompt and promptAsync
    const promptMock = mock(() => Promise.resolve())
    const promptAsyncMock = mock(() => Promise.resolve())
    const client = { session: { prompt: promptMock, promptAsync: promptAsyncMock } }

    // when calling promptSyncWithModelSuggestionRetry
    await promptSyncWithModelSuggestionRetry(unsafeTestValue(client), {
      path: { id: "session-1" },
      body: {
        parts: [{ type: "text", text: "hello" }],
        model: { providerID: "anthropic", modelID: "claude-sonnet-4" },
      },
    })

    // then should call prompt (sync), NOT promptAsync
    expect(promptMock).toHaveBeenCalledTimes(1)
    expect(promptAsyncMock).toHaveBeenCalledTimes(0)
  })

  it("#given sync prompt retry just dispatched #when the same session is prompted again immediately #then the second caller is deferred instead of queued", async () => {
    // given
    const promptMock = mock(async () => undefined)
    const client = {
      session: {
        prompt: promptMock,
      },
    }
    const args = {
      path: { id: "session-sync-post-dispatch-hold" },
      body: {
        parts: [{ type: "text", text: "hello" }],
        model: { providerID: "anthropic", modelID: "claude-sonnet-4" },
      },
    }

    // when
    await promptSyncWithModelSuggestionRetry(unsafeTestValue(client), args)
    const second = promptSyncWithModelSuggestionRetry(unsafeTestValue(client), args)

    // then
    await expect(second).rejects.toThrow("prompt skipped by gate: reserved")
    expect(promptMock).toHaveBeenCalledTimes(1)
  })

  it("should abort and throw timeout error when sync prompt hangs", async () => {
    // given a client where sync prompt never resolves unless aborted
    let receivedSignal: AbortSignal | undefined
    const promptMock = mock((input: { signal?: AbortSignal }) => {
      receivedSignal = input.signal
      return new Promise((_, reject) => {
        const signal = input.signal
        if (!signal) {
          return
        }
        signal.addEventListener("abort", () => {
          reject(signal.reason)
        })
      })
    })
    const client = {
      session: {
        prompt: promptMock,
        promptAsync: mock(() => Promise.resolve()),
      },
    }

    // when calling with short timeout
    // then should abort the request and throw timeout error
    await expect(
      promptSyncWithModelSuggestionRetry(unsafeTestValue(client), {
        path: { id: "session-1" },
        body: {
          parts: [{ type: "text", text: "hello" }],
          model: { providerID: "anthropic", modelID: "claude-sonnet-4" },
        },
      }, { timeoutMs: 1 })
    ).rejects.toThrow("prompt timed out after 1ms")

    expect(receivedSignal?.aborted).toBe(true)
  })

  it("should retry with suggested model on ProviderModelNotFoundError", async () => {
    // given a client that fails first with model-not-found, then succeeds
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

    // when calling promptSyncWithModelSuggestionRetry
    await promptSyncWithModelSuggestionRetry(unsafeTestValue(client), {
      path: { id: "session-1" },
      body: {
        parts: [{ type: "text", text: "hello" }],
        model: { providerID: "anthropic", modelID: "claude-sonet-4" },
      },
    })

    // then should call prompt twice (original + retry with suggestion)
    expect(promptMock).toHaveBeenCalledTimes(2)
    const retryCall = promptMock.mock.calls[1][0]
    expect(retryCall.body.model).toEqual({
      providerID: "anthropic",
      modelID: "claude-sonnet-4",
    })
  })

  it("should throw original error when no suggestion available", async () => {
    // given a client that fails with a non-model error
    const originalError = new Error("Connection refused")
    const promptMock = mock().mockRejectedValueOnce(originalError)
    const client = { session: { prompt: promptMock } }

    // when calling promptSyncWithModelSuggestionRetry
    // then should throw the original error
    await expect(
      promptSyncWithModelSuggestionRetry(unsafeTestValue(client), {
        path: { id: "session-1" },
        body: {
          parts: [{ type: "text", text: "hello" }],
          model: { providerID: "anthropic", modelID: "claude-sonnet-4" },
        },
      })
    ).rejects.toThrow("Connection refused")

    expect(promptMock).toHaveBeenCalledTimes(1)
  })

  it("should throw when model-not-found but no model in original request", async () => {
    // given a client that fails with model error but no model in body
    const promptMock = mock().mockRejectedValueOnce({
      name: "ProviderModelNotFoundError",
      data: {
        providerID: "anthropic",
        modelID: "claude-sonet-4",
        suggestions: ["claude-sonnet-4"],
      },
    })
    const client = { session: { prompt: promptMock } }

    // when calling without model in body
    // then should throw (cannot retry without original model)
    await expect(
      promptSyncWithModelSuggestionRetry(unsafeTestValue(client), {
        path: { id: "session-1" },
        body: {
          parts: [{ type: "text", text: "hello" }],
        },
      })
    ).rejects.toThrow()

    expect(promptMock).toHaveBeenCalledTimes(1)
  })

  it("should pass all body fields through to prompt", async () => {
    // given a client where prompt succeeds
    const promptMock = mock().mockResolvedValueOnce(undefined)
    const client = { session: { prompt: promptMock } }

    // when calling with additional body fields
    await promptSyncWithModelSuggestionRetry(unsafeTestValue(client), {
      path: { id: "session-1" },
      body: {
        agent: "multimodal-looker",
        tools: { task: false },
        parts: [{ type: "text", text: "analyze" }],
        model: { providerID: "google", modelID: "gemini-3-flash" },
        variant: "max",
      },
    })

    // then call should pass all fields through unchanged
    const call = promptMock.mock.calls[0][0]
    expect(call.body.agent).toBe("multimodal-looker")
    expect(call.body.tools).toEqual({ task: false })
    expect(call.body.variant).toBe("max")
  })
})
