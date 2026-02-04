import { describe, expect, test, beforeEach, afterEach, spyOn } from "bun:test"
import { createRuntimeFallbackHook, type RuntimeFallbackHook } from "./index"
import type { RuntimeFallbackConfig, OhMyOpenCodeConfig } from "../../config"
import * as sharedModule from "../../shared"
import { SessionCategoryRegistry } from "../../shared/session-category-registry"

describe("runtime-fallback", () => {
  let logCalls: Array<{ msg: string; data?: unknown }>
  let logSpy: ReturnType<typeof spyOn>
  let toastCalls: Array<{ title: string; message: string; variant: string }>

  beforeEach(() => {
    logCalls = []
    toastCalls = []
    SessionCategoryRegistry.clear()
    logSpy = spyOn(sharedModule, "log").mockImplementation((msg: string, data?: unknown) => {
      logCalls.push({ msg, data })
    })
  })

  afterEach(() => {
    SessionCategoryRegistry.clear()
    logSpy?.mockRestore()
  })

  function createMockPluginInput() {
    return {
      client: {
        tui: {
          showToast: async (opts: { body: { title: string; message: string; variant: string; duration: number } }) => {
            toastCalls.push({
              title: opts.body.title,
              message: opts.body.message,
              variant: opts.body.variant,
            })
          },
        },
      },
      directory: "/test/dir",
    } as any
  }

  function createMockConfig(overrides?: Partial<RuntimeFallbackConfig>): RuntimeFallbackConfig {
    return {
      enabled: true,
      retry_on_errors: [429, 503, 529],
      max_fallback_attempts: 3,
      cooldown_seconds: 60,
      notify_on_fallback: true,
      ...overrides,
    }
  }

  function createMockPluginConfigWithCategoryFallback(fallbackModels: string[]): OhMyOpenCodeConfig {
    return {
      categories: {
        test: {
          fallback_models: fallbackModels,
        },
      },
    }
  }

  describe("session.error handling", () => {
    test("should detect retryable error with status code 429", async () => {
      const hook = createRuntimeFallbackHook(createMockPluginInput(), { config: createMockConfig() })
      const sessionID = "test-session-123"

      await hook.event({
        event: {
          type: "session.created",
          properties: { info: { id: sessionID, model: "anthropic/claude-opus-4-5" } },
        },
      })

      await hook.event({
        event: {
          type: "session.error",
          properties: { sessionID, error: { statusCode: 429, message: "Rate limit exceeded" } },
        },
      })

      const fallbackLog = logCalls.find((c) => c.msg.includes("session.error received"))
      expect(fallbackLog).toBeDefined()
      expect(fallbackLog?.data).toMatchObject({ sessionID, statusCode: 429 })
    })

    test("should detect retryable error with status code 503", async () => {
      const hook = createRuntimeFallbackHook(createMockPluginInput(), { config: createMockConfig() })
      const sessionID = "test-session-503"

      await hook.event({
        event: {
          type: "session.created",
          properties: { info: { id: sessionID, model: "openai/gpt-5.2" } },
        },
      })

      await hook.event({
        event: {
          type: "session.error",
          properties: { sessionID, error: { statusCode: 503, message: "Service unavailable" } },
        },
      })

      const errorLog = logCalls.find((c) => c.msg.includes("session.error received"))
      expect(errorLog).toBeDefined()
    })

    test("should detect retryable error with status code 529", async () => {
      const hook = createRuntimeFallbackHook(createMockPluginInput(), { config: createMockConfig() })
      const sessionID = "test-session-529"

      await hook.event({
        event: {
          type: "session.created",
          properties: { info: { id: sessionID, model: "google/gemini-3-pro" } },
        },
      })

      await hook.event({
        event: {
          type: "session.error",
          properties: { sessionID, error: { statusCode: 529, message: "Overloaded" } },
        },
      })

      const errorLog = logCalls.find((c) => c.msg.includes("session.error received"))
      expect(errorLog).toBeDefined()
    })

    test("should skip non-retryable errors", async () => {
      const hook = createRuntimeFallbackHook(createMockPluginInput(), { config: createMockConfig() })
      const sessionID = "test-session-400"

      await hook.event({
        event: {
          type: "session.created",
          properties: { info: { id: sessionID, model: "anthropic/claude-opus-4-5" } },
        },
      })

      await hook.event({
        event: {
          type: "session.error",
          properties: { sessionID, error: { statusCode: 400, message: "Bad request" } },
        },
      })

      const skipLog = logCalls.find((c) => c.msg.includes("Error not retryable"))
      expect(skipLog).toBeDefined()
    })

    test("should detect retryable error from message pattern 'rate limit'", async () => {
      const hook = createRuntimeFallbackHook(createMockPluginInput(), { config: createMockConfig() })
      const sessionID = "test-session-pattern"

      await hook.event({
        event: {
          type: "session.created",
          properties: { info: { id: sessionID, model: "anthropic/claude-opus-4-5" } },
        },
      })

      await hook.event({
        event: {
          type: "session.error",
          properties: { sessionID, error: { message: "You have hit the rate limit" } },
        },
      })

      const errorLog = logCalls.find((c) => c.msg.includes("session.error received"))
      expect(errorLog).toBeDefined()
    })

    test("should log when no fallback models configured", async () => {
      const hook = createRuntimeFallbackHook(createMockPluginInput(), { config: createMockConfig() })
      const sessionID = "test-session-no-fallbacks"

      await hook.event({
        event: {
          type: "session.created",
          properties: { info: { id: sessionID, model: "anthropic/claude-opus-4-5" } },
        },
      })

      await hook.event({
        event: {
          type: "session.error",
          properties: { sessionID, error: { statusCode: 429, message: "Rate limit" } },
        },
      })

      const noFallbackLog = logCalls.find((c) => c.msg.includes("No fallback models configured"))
      expect(noFallbackLog).toBeDefined()
    })
  })

  describe("disabled hook", () => {
    test("should not process events when disabled", async () => {
      const hook = createRuntimeFallbackHook(createMockPluginInput(), {
        config: createMockConfig({ enabled: false }),
      })
      const sessionID = "test-session-disabled"

      await hook.event({
        event: {
          type: "session.error",
          properties: { sessionID, error: { statusCode: 429 } },
        },
      })

      const sessionErrorLog = logCalls.find((c) => c.msg.includes("session.error received"))
      expect(sessionErrorLog).toBeUndefined()
    })
  })

  describe("session lifecycle", () => {
    test("should create state on session.created", async () => {
      const hook = createRuntimeFallbackHook(createMockPluginInput(), { config: createMockConfig() })
      const sessionID = "test-session-create"
      const model = "anthropic/claude-opus-4-5"

      await hook.event({
        event: {
          type: "session.created",
          properties: { info: { id: sessionID, model } },
        },
      })

      const createLog = logCalls.find((c) => c.msg.includes("Session created with model"))
      expect(createLog).toBeDefined()
      expect(createLog?.data).toMatchObject({ sessionID, model })
    })

    test("should cleanup state on session.deleted", async () => {
      const hook = createRuntimeFallbackHook(createMockPluginInput(), { config: createMockConfig() })
      const sessionID = "test-session-delete"

      await hook.event({
        event: {
          type: "session.created",
          properties: { info: { id: sessionID, model: "anthropic/claude-opus-4-5" } },
        },
      })

      await hook.event({
        event: {
          type: "session.deleted",
          properties: { info: { id: sessionID } },
        },
      })

      const deleteLog = logCalls.find((c) => c.msg.includes("Cleaning up session state"))
      expect(deleteLog).toBeDefined()
      expect(deleteLog?.data).toMatchObject({ sessionID })
    })

    test("should handle session.error without prior session.created", async () => {
      const hook = createRuntimeFallbackHook(createMockPluginInput(), { config: createMockConfig() })
      const sessionID = "test-session-no-create"

      await hook.event({
        event: {
          type: "session.error",
          properties: {
            sessionID,
            error: { statusCode: 429 },
            model: "anthropic/claude-opus-4-5",
          },
        },
      })

      const errorLog = logCalls.find((c) => c.msg.includes("session.error received"))
      expect(errorLog).toBeDefined()
    })
  })

  describe("error code extraction", () => {
    test("should extract status code from error object", async () => {
      const hook = createRuntimeFallbackHook(createMockPluginInput(), { config: createMockConfig() })
      const sessionID = "test-extract-status"

      await hook.event({
        event: {
          type: "session.created",
          properties: { info: { id: sessionID, model: "test-model" } },
        },
      })

      await hook.event({
        event: {
          type: "session.error",
          properties: {
            sessionID,
            error: { statusCode: 429, message: "Rate limit" },
          },
        },
      })

      const statusLog = logCalls.find((c) => c.data && typeof c.data === "object" && "statusCode" in c.data)
      expect(statusLog?.data).toMatchObject({ statusCode: 429 })
    })

    test("should extract status code from nested error.data", async () => {
      const hook = createRuntimeFallbackHook(createMockPluginInput(), { config: createMockConfig() })
      const sessionID = "test-nested-status"

      await hook.event({
        event: {
          type: "session.created",
          properties: { info: { id: sessionID, model: "test-model" } },
        },
      })

      await hook.event({
        event: {
          type: "session.error",
          properties: {
            sessionID,
            error: { data: { statusCode: 503, message: "Service unavailable" } },
          },
        },
      })

      const errorLog = logCalls.find((c) => c.msg.includes("session.error received"))
      expect(errorLog).toBeDefined()
    })
  })

  describe("custom error codes", () => {
    test("should support custom retry_on_errors configuration", async () => {
      const hook = createRuntimeFallbackHook(createMockPluginInput(), {
        config: createMockConfig({ retry_on_errors: [500, 502] }),
      })
      const sessionID = "test-session-custom"

      await hook.event({
        event: {
          type: "session.created",
          properties: { info: { id: sessionID, model: "test-model" } },
        },
      })

      await hook.event({
        event: {
          type: "session.error",
          properties: { sessionID, error: { statusCode: 500 } },
        },
      })

      const errorLog = logCalls.find((c) => c.msg.includes("session.error received"))
      expect(errorLog).toBeDefined()
    })
  })

  describe("message.updated handling", () => {
    test("should handle assistant message errors", async () => {
      const hook = createRuntimeFallbackHook(createMockPluginInput(), { config: createMockConfig() })
      const sessionID = "test-message-updated"

      await hook.event({
        event: {
          type: "message.updated",
          properties: {
            info: {
              sessionID,
              role: "assistant",
              error: { statusCode: 429, message: "Rate limit" },
              model: "anthropic/claude-opus-4-5",
            },
          },
        },
      })

      const errorLog = logCalls.find((c) => c.msg.includes("message.updated with assistant error"))
      expect(errorLog).toBeDefined()
    })

    test("should skip non-assistant message errors", async () => {
      const hook = createRuntimeFallbackHook(createMockPluginInput(), { config: createMockConfig() })
      const sessionID = "test-message-user"

      await hook.event({
        event: {
          type: "message.updated",
          properties: {
            info: {
              sessionID,
              role: "user",
              error: { statusCode: 429 },
              model: "anthropic/claude-opus-4-5",
            },
          },
        },
      })

      const errorLog = logCalls.find((c) => c.msg.includes("message.updated with assistant error"))
      expect(errorLog).toBeUndefined()
    })
  })

  describe("edge cases", () => {
    test("should handle session.error without sessionID", async () => {
      const hook = createRuntimeFallbackHook(createMockPluginInput(), { config: createMockConfig() })

      await hook.event({
        event: {
          type: "session.error",
          properties: { error: { statusCode: 429 } },
        },
      })

      const skipLog = logCalls.find((c) => c.msg.includes("session.error without sessionID"))
      expect(skipLog).toBeDefined()
    })

    test("should handle error as string", async () => {
      const hook = createRuntimeFallbackHook(createMockPluginInput(), { config: createMockConfig() })
      const sessionID = "test-error-string"

      await hook.event({
        event: {
          type: "session.created",
          properties: { info: { id: sessionID, model: "test-model" } },
        },
      })

      await hook.event({
        event: {
          type: "session.error",
          properties: { sessionID, error: "rate limit exceeded" },
        },
      })

      const errorLog = logCalls.find((c) => c.msg.includes("session.error received"))
      expect(errorLog).toBeDefined()
    })

    test("should handle null error", async () => {
      const hook = createRuntimeFallbackHook(createMockPluginInput(), { config: createMockConfig() })
      const sessionID = "test-error-null"

      await hook.event({
        event: {
          type: "session.created",
          properties: { info: { id: sessionID, model: "test-model" } },
        },
      })

      await hook.event({
        event: {
          type: "session.error",
          properties: { sessionID, error: null },
        },
      })

      const skipLog = logCalls.find((c) => c.msg.includes("Error not retryable"))
      expect(skipLog).toBeDefined()
    })
  })

  describe("model switching via chat.message", () => {
    test("should apply fallback model on next chat.message after error", async () => {
      const hook = createRuntimeFallbackHook(createMockPluginInput(), {
        config: createMockConfig({ notify_on_fallback: false }),
        pluginConfig: createMockPluginConfigWithCategoryFallback(["openai/gpt-5.2", "google/gemini-3-pro"]),
      })
      const sessionID = "test-session-switch"
      SessionCategoryRegistry.register(sessionID, "test")

      //#given
      await hook.event({
        event: {
          type: "session.created",
          properties: { info: { id: sessionID, model: "anthropic/claude-opus-4-5" } },
        },
      })

      //#when
      await hook.event({
        event: {
          type: "session.error",
          properties: { sessionID, error: { statusCode: 429, message: "Rate limit" } },
        },
      })

      const output = { message: {}, parts: [] }
      await hook["chat.message"]?.(
        { sessionID, model: { providerID: "anthropic", modelID: "claude-opus-4-5" } },
        output
      )

      expect(output.message.model).toEqual({ providerID: "openai", modelID: "gpt-5.2" })
    })

    test("should notify when fallback occurs", async () => {
      const hook = createRuntimeFallbackHook(createMockPluginInput(), {
        config: createMockConfig({ notify_on_fallback: true }),
        pluginConfig: createMockPluginConfigWithCategoryFallback(["openai/gpt-5.2"]),
      })
      const sessionID = "test-session-notify"
      SessionCategoryRegistry.register(sessionID, "test")

      await hook.event({
        event: {
          type: "session.created",
          properties: { info: { id: sessionID, model: "anthropic/claude-opus-4-5" } },
        },
      })

      await hook.event({
        event: {
          type: "session.error",
          properties: { sessionID, error: { statusCode: 429 } },
        },
      })

      expect(toastCalls.length).toBe(1)
      expect(toastCalls[0]?.message.includes("gpt-5.2")).toBe(true)
    })
  })

  describe("fallback models configuration", () => {
    test("should use agent-level fallback_models", async () => {
      const input = createMockPluginInput()
      const hook = createRuntimeFallbackHook(input, { config: createMockConfig() })
      const sessionID = "test-agent-fallback"

      //#given - agent with custom fallback models
      await hook.event({
        event: {
          type: "session.created",
          properties: { info: { id: sessionID, model: "anthropic/claude-opus-4-5", agent: "oracle" } },
        },
      })

      //#when - error occurs
      await hook.event({
        event: {
          type: "session.error",
          properties: { sessionID, error: { statusCode: 503 }, agent: "oracle" },
        },
      })

      //#then - should use oracle's fallback models
      const fallbackLog = logCalls.find((c) => c.msg.includes("No fallback models configured") || c.msg.includes("Fallback triggered"))
      expect(fallbackLog).toBeDefined()
    })

    test("should detect agent from sessionID pattern", async () => {
      const hook = createRuntimeFallbackHook(createMockPluginInput(), { config: createMockConfig() })
      const sessionID = "sisyphus-session-123"

      await hook.event({
        event: {
          type: "session.created",
          properties: { info: { id: sessionID, model: "anthropic/claude-opus-4-5" } },
        },
      })

      await hook.event({
        event: {
          type: "session.error",
          properties: { sessionID, error: { statusCode: 429 } },
        },
      })

      const errorLog = logCalls.find((c) => c.msg.includes("session.error received"))
      expect(errorLog?.data).toMatchObject({ sessionID })
    })
  })

  describe("cooldown mechanism", () => {
    test("should respect cooldown period before retrying failed model", async () => {
      const hook = createRuntimeFallbackHook(createMockPluginInput(), {
        config: createMockConfig({ cooldown_seconds: 60, notify_on_fallback: false }),
        pluginConfig: createMockPluginConfigWithCategoryFallback([
          "openai/gpt-5.2",
          "anthropic/claude-opus-4-5",
        ]),
      })
      const sessionID = "test-session-cooldown"
      SessionCategoryRegistry.register(sessionID, "test")

      await hook.event({
        event: {
          type: "session.created",
          properties: { info: { id: sessionID, model: "anthropic/claude-opus-4-5" } },
        },
      })

      //#when - first error occurs, switches to openai
      await hook.event({
        event: {
          type: "session.error",
          properties: { sessionID, error: { statusCode: 429 } },
        },
      })

      //#when - second error occurs immediately; tries to switch back to original model but should be in cooldown
      await hook.event({
        event: {
          type: "session.error",
          properties: { sessionID, error: { statusCode: 429 } },
        },
      })

      const cooldownSkipLog = logCalls.find((c) => c.msg.includes("Skipping fallback model in cooldown"))
      expect(cooldownSkipLog).toBeDefined()
    })
  })

  describe("max attempts limit", () => {
    test("should stop after max_fallback_attempts", async () => {
      const hook = createRuntimeFallbackHook(createMockPluginInput(), {
        config: createMockConfig({ max_fallback_attempts: 2 }),
      })
      const sessionID = "test-session-max"

      await hook.event({
        event: {
          type: "session.created",
          properties: { info: { id: sessionID, model: "anthropic/claude-opus-4-5" } },
        },
      })

      //#when - multiple errors occur exceeding max attempts
      for (let i = 0; i < 5; i++) {
        await hook.event({
          event: {
            type: "session.error",
            properties: { sessionID, error: { statusCode: 429 } },
          },
        })
      }

      //#then - should have stopped after max attempts
      const maxLog = logCalls.find((c) => c.msg.includes("Max fallback attempts reached") || c.msg.includes("No fallback models"))
      expect(maxLog).toBeDefined()
    })
  })
})
