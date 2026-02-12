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

  function createMockPluginInput(overrides?: {
    session?: {
      messages?: (args: unknown) => Promise<unknown>
      promptAsync?: (args: unknown) => Promise<unknown>
      abort?: (args: unknown) => Promise<unknown>
    }
  }) {
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
        session: {
          messages: overrides?.session?.messages ?? (async () => ({ data: [] })),
          promptAsync: overrides?.session?.promptAsync ?? (async () => ({})),
          abort: overrides?.session?.abort ?? (async () => ({})),
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

    test("should log missing API key errors with classification details", async () => {
      const hook = createRuntimeFallbackHook(createMockPluginInput(), { config: createMockConfig() })
      const sessionID = "test-session-missing-api-key"

      await hook.event({
        event: {
          type: "session.created",
          properties: { info: { id: sessionID, model: "google/gemini-2.5-pro" } },
        },
      })

      await hook.event({
        event: {
          type: "session.error",
          properties: {
            sessionID,
            error: {
              name: "AI_LoadAPIKeyError",
              message:
                "Google Generative AI API key is missing. Pass it using the 'apiKey' parameter or the GOOGLE_GENERATIVE_AI_API_KEY environment variable.",
            },
          },
        },
      })

      const sessionErrorLog = logCalls.find((c) => c.msg.includes("session.error received"))
      expect(sessionErrorLog).toBeDefined()
      expect(sessionErrorLog?.data).toMatchObject({
        sessionID,
        errorName: "AI_LoadAPIKeyError",
        errorType: "missing_api_key",
      })

      const skipLog = logCalls.find((c) => c.msg.includes("Error not retryable"))
      expect(skipLog).toBeUndefined()
    })

    test("should trigger fallback for missing API key errors when fallback models are configured", async () => {
      const hook = createRuntimeFallbackHook(createMockPluginInput(), {
        config: createMockConfig({ notify_on_fallback: false }),
        pluginConfig: createMockPluginConfigWithCategoryFallback(["openai/gpt-5.2"]),
      })
      const sessionID = "test-session-missing-api-key-fallback"
      SessionCategoryRegistry.register(sessionID, "test")

      await hook.event({
        event: {
          type: "session.created",
          properties: { info: { id: sessionID, model: "google/gemini-2.5-pro" } },
        },
      })

      await hook.event({
        event: {
          type: "session.error",
          properties: {
            sessionID,
            error: {
              name: "AI_LoadAPIKeyError",
              message:
                "Google Generative AI API key is missing. Pass it using the 'apiKey' parameter or the GOOGLE_GENERATIVE_AI_API_KEY environment variable.",
            },
          },
        },
      })

      const fallbackLog = logCalls.find((c) => c.msg.includes("Preparing fallback"))
      expect(fallbackLog).toBeDefined()
      expect(fallbackLog?.data).toMatchObject({ from: "google/gemini-2.5-pro", to: "openai/gpt-5.2" })
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

    test("should continue fallback chain when fallback model is not found", async () => {
      const hook = createRuntimeFallbackHook(createMockPluginInput(), {
        config: createMockConfig({ notify_on_fallback: false }),
        pluginConfig: createMockPluginConfigWithCategoryFallback([
          "anthropic/claude-opus-4.6",
          "openai/gpt-5.2",
        ]),
      })
      const sessionID = "test-session-model-not-found"
      SessionCategoryRegistry.register(sessionID, "test")

      await hook.event({
        event: {
          type: "session.created",
          properties: { info: { id: sessionID, model: "google/gemini-2.5-pro" } },
        },
      })

      await hook.event({
        event: {
          type: "session.error",
          properties: {
            sessionID,
            error: {
              name: "ProviderAuthError",
              data: {
                providerID: "google",
                message:
                  "Google Generative AI API key is missing. Pass it using the 'apiKey' parameter or the GOOGLE_GENERATIVE_AI_API_KEY environment variable.",
              },
            },
          },
        },
      })

      await hook.event({
        event: {
          type: "session.error",
          properties: {
            sessionID,
            error: { name: "UnknownError", data: { message: "Model not found: anthropic/claude-opus-4.6." } },
          },
        },
      })

      const fallbackLogs = logCalls.filter((c) => c.msg.includes("Preparing fallback"))
      expect(fallbackLogs.length).toBeGreaterThanOrEqual(2)
      expect(fallbackLogs[1]?.data).toMatchObject({ from: "anthropic/claude-opus-4.6", to: "openai/gpt-5.2" })

      const nonRetryLog = logCalls.find(
        (c) => c.msg.includes("Error not retryable") && (c.data as { sessionID?: string } | undefined)?.sessionID === sessionID
      )
      expect(nonRetryLog).toBeUndefined()
    })

    test("should trigger fallback on Copilot auto-retry signal in message.updated", async () => {
      const hook = createRuntimeFallbackHook(createMockPluginInput(), {
        config: createMockConfig({ notify_on_fallback: false }),
        pluginConfig: createMockPluginConfigWithCategoryFallback(["openai/gpt-5.2"]),
      })

      const sessionID = "test-session-copilot-auto-retry"
      SessionCategoryRegistry.register(sessionID, "test")

      await hook.event({
        event: {
          type: "session.created",
          properties: { info: { id: sessionID, model: "github-copilot/claude-opus-4.6" } },
        },
      })

      await hook.event({
        event: {
          type: "message.updated",
          properties: {
            info: {
              sessionID,
              role: "assistant",
              model: "github-copilot/claude-opus-4.6",
              status:
                "Too Many Requests: quota exceeded [retrying in ~2 weeks attempt #1]",
            },
          },
        },
      })

      const signalLog = logCalls.find((c) => c.msg.includes("Detected Copilot auto-retry signal"))
      expect(signalLog).toBeDefined()

      const fallbackLog = logCalls.find((c) => c.msg.includes("Preparing fallback"))
      expect(fallbackLog).toBeDefined()
      expect(fallbackLog?.data).toMatchObject({ from: "github-copilot/claude-opus-4.6", to: "openai/gpt-5.2" })
    })

    test("should log when no fallback models configured", async () => {
      const hook = createRuntimeFallbackHook(createMockPluginInput(), {
        config: createMockConfig(),
        pluginConfig: {},
      })
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

    test("should trigger fallback when message.updated has missing API key error without model", async () => {
      const hook = createRuntimeFallbackHook(createMockPluginInput(), {
        config: createMockConfig({ notify_on_fallback: false }),
        pluginConfig: createMockPluginConfigWithCategoryFallback(["openai/gpt-5.2"]),
      })
      const sessionID = "test-message-updated-missing-model"
      SessionCategoryRegistry.register(sessionID, "test")

      await hook.event({
        event: {
          type: "session.created",
          properties: { info: { id: sessionID, model: "google/gemini-2.5-pro" } },
        },
      })

      await hook.event({
        event: {
          type: "message.updated",
          properties: {
            info: {
              sessionID,
              role: "assistant",
              error: {
                name: "AI_LoadAPIKeyError",
                message:
                  "Google Generative AI API key is missing. Pass it using the 'apiKey' parameter or the GOOGLE_GENERATIVE_AI_API_KEY environment variable.",
              },
            },
          },
        },
      })

      const fallbackLog = logCalls.find((c) => c.msg.includes("Preparing fallback"))
      expect(fallbackLog).toBeDefined()
      expect(fallbackLog?.data).toMatchObject({ from: "google/gemini-2.5-pro", to: "openai/gpt-5.2" })
    })

    test("should not advance fallback state from message.updated while retry is already in flight", async () => {
      const pending = new Promise<never>(() => {})

      const hook = createRuntimeFallbackHook(
        createMockPluginInput({
          session: {
            messages: async () => ({
              data: [{ info: { role: "user" }, parts: [{ type: "text", text: "hello" }] }],
            }),
            promptAsync: async () => pending,
          },
        }),
        {
          config: createMockConfig({ notify_on_fallback: false }),
          pluginConfig: createMockPluginConfigWithCategoryFallback([
            "github-copilot/claude-opus-4.6",
            "anthropic/claude-opus-4-6",
            "openai/gpt-5.2",
          ]),
        }
      )

      const sessionID = "test-message-updated-inflight-race"
      SessionCategoryRegistry.register(sessionID, "test")

      await hook.event({
        event: {
          type: "session.created",
          properties: { info: { id: sessionID, model: "google/gemini-2.5-pro" } },
        },
      })

      const sessionErrorPromise = hook.event({
        event: {
          type: "session.error",
          properties: {
            sessionID,
            error: {
              name: "ProviderAuthError",
              data: {
                providerID: "google",
                message:
                  "Google Generative AI API key is missing. Pass it using the 'apiKey' parameter or the GOOGLE_GENERATIVE_AI_API_KEY environment variable.",
              },
            },
          },
        },
      })

      await new Promise((resolve) => setTimeout(resolve, 0))

      await hook.event({
        event: {
          type: "message.updated",
          properties: {
            info: {
              sessionID,
              role: "assistant",
              error: {
                name: "ProviderAuthError",
                data: {
                  providerID: "google",
                  message:
                    "Google Generative AI API key is missing. Pass it using the 'apiKey' parameter or the GOOGLE_GENERATIVE_AI_API_KEY environment variable.",
                },
              },
              model: "github-copilot/claude-opus-4.6",
            },
          },
        },
      })

      const fallbackLogs = logCalls.filter((c) => c.msg.includes("Preparing fallback"))
      expect(fallbackLogs).toHaveLength(1)

      void sessionErrorPromise
    })

    test("should force advance fallback from message.updated when Copilot auto-retry signal appears during in-flight retry", async () => {
      const retriedModels: string[] = []
      const pending = new Promise<never>(() => {})

      const hook = createRuntimeFallbackHook(
        createMockPluginInput({
          session: {
            messages: async () => ({
              data: [{ info: { role: "user" }, parts: [{ type: "text", text: "hello" }] }],
            }),
            promptAsync: async (args: unknown) => {
              const model = (args as { body?: { model?: { providerID?: string; modelID?: string } } })?.body?.model
              if (model?.providerID && model?.modelID) {
                retriedModels.push(`${model.providerID}/${model.modelID}`)
              }

              if (retriedModels.length === 1) {
                await pending
              }

              return {}
            },
          },
        }),
        {
          config: createMockConfig({ notify_on_fallback: false }),
          pluginConfig: createMockPluginConfigWithCategoryFallback([
            "github-copilot/claude-opus-4.6",
            "anthropic/claude-opus-4-6",
            "openai/gpt-5.2",
          ]),
        }
      )

      const sessionID = "test-message-updated-inflight-retry-signal"
      SessionCategoryRegistry.register(sessionID, "test")

      await hook.event({
        event: {
          type: "session.created",
          properties: { info: { id: sessionID, model: "google/gemini-2.5-pro" } },
        },
      })

      const sessionErrorPromise = hook.event({
        event: {
          type: "session.error",
          properties: {
            sessionID,
            error: {
              name: "ProviderAuthError",
              data: {
                providerID: "google",
                message:
                  "Google Generative AI API key is missing. Pass it using the 'apiKey' parameter or the GOOGLE_GENERATIVE_AI_API_KEY environment variable.",
              },
            },
          },
        },
      })

      await new Promise((resolve) => setTimeout(resolve, 0))

      await hook.event({
        event: {
          type: "message.updated",
          properties: {
            info: {
              sessionID,
              role: "assistant",
              model: "github-copilot/claude-opus-4.6",
              status:
                "Too Many Requests: quota exceeded [retrying in ~2 weeks attempt #1]",
            },
          },
        },
      })

      expect(retriedModels.length).toBeGreaterThanOrEqual(2)
      expect(retriedModels[0]).toBe("github-copilot/claude-opus-4.6")
      expect(retriedModels[1]).toBe("anthropic/claude-opus-4-6")

      void sessionErrorPromise
    })

    test("should advance fallback after session timeout when Copilot retry emits no retryable events", async () => {
      const retriedModels: string[] = []
      const abortCalls: Array<{ path?: { id?: string } }> = []

      const hook = createRuntimeFallbackHook(
        createMockPluginInput({
          session: {
            messages: async () => ({
              data: [{ info: { role: "user" }, parts: [{ type: "text", text: "hello" }] }],
            }),
            promptAsync: async (args: unknown) => {
              const model = (args as { body?: { model?: { providerID?: string; modelID?: string } } })?.body?.model
              if (model?.providerID && model?.modelID) {
                retriedModels.push(`${model.providerID}/${model.modelID}`)
              }
              return {}
            },
            abort: async (args: unknown) => {
              abortCalls.push(args as { path?: { id?: string } })
              return {}
            },
          },
        }),
        {
          config: createMockConfig({ notify_on_fallback: false, timeout_seconds: 30 }),
          pluginConfig: createMockPluginConfigWithCategoryFallback([
            "github-copilot/claude-opus-4.6",
            "anthropic/claude-opus-4-6",
            "openai/gpt-5.2",
          ]),
          session_timeout_ms: 20,
        }
      )

      const sessionID = "test-session-timeout-watchdog"
      SessionCategoryRegistry.register(sessionID, "test")

      await hook.event({
        event: {
          type: "session.created",
          properties: { info: { id: sessionID, model: "google/gemini-2.5-pro" } },
        },
      })

      await hook.event({
        event: {
          type: "session.error",
          properties: {
            sessionID,
            error: {
              name: "ProviderAuthError",
              data: {
                providerID: "google",
                message:
                  "Google Generative AI API key is missing. Pass it using the 'apiKey' parameter or the GOOGLE_GENERATIVE_AI_API_KEY environment variable.",
              },
            },
          },
        },
      })

      await new Promise((resolve) => setTimeout(resolve, 50))

      expect(retriedModels).toContain("github-copilot/claude-opus-4.6")
      expect(retriedModels).toContain("anthropic/claude-opus-4-6")
      expect(abortCalls.some((call) => call.path?.id === sessionID)).toBe(true)

      const timeoutLog = logCalls.find((c) => c.msg.includes("Session fallback timeout reached"))
      expect(timeoutLog).toBeDefined()
    })

    test("should keep session timeout active after chat.message model override", async () => {
      const retriedModels: string[] = []

      const hook = createRuntimeFallbackHook(
        createMockPluginInput({
          session: {
            messages: async () => ({
              data: [{ info: { role: "user" }, parts: [{ type: "text", text: "hello" }] }],
            }),
            promptAsync: async (args: unknown) => {
              const model = (args as { body?: { model?: { providerID?: string; modelID?: string } } })?.body?.model
              if (model?.providerID && model?.modelID) {
                retriedModels.push(`${model.providerID}/${model.modelID}`)
              }
              return {}
            },
          },
        }),
        {
          config: createMockConfig({ notify_on_fallback: false, timeout_seconds: 30 }),
          pluginConfig: createMockPluginConfigWithCategoryFallback([
            "github-copilot/claude-opus-4.6",
            "anthropic/claude-opus-4-6",
            "openai/gpt-5.2",
          ]),
          session_timeout_ms: 20,
        }
      )

      const sessionID = "test-session-timeout-after-chat-message"
      SessionCategoryRegistry.register(sessionID, "test")

      await hook.event({
        event: {
          type: "session.created",
          properties: { info: { id: sessionID, model: "google/gemini-2.5-pro" } },
        },
      })

      await hook.event({
        event: {
          type: "session.error",
          properties: {
            sessionID,
            error: {
              name: "ProviderAuthError",
              data: {
                providerID: "google",
                message:
                  "Google Generative AI API key is missing. Pass it using the 'apiKey' parameter or the GOOGLE_GENERATIVE_AI_API_KEY environment variable.",
              },
            },
          },
        },
      })

      const output: { message: { model?: { providerID: string; modelID: string } }; parts: Array<{ type: string; text?: string }> } = {
        message: {},
        parts: [],
      }
      await hook["chat.message"]?.(
        {
          sessionID,
          model: { providerID: "github-copilot", modelID: "claude-opus-4.6" },
        },
        output
      )

      await new Promise((resolve) => setTimeout(resolve, 50))

      expect(retriedModels).toContain("github-copilot/claude-opus-4.6")
      expect(retriedModels).toContain("anthropic/claude-opus-4-6")
    })

    test("should abort in-flight fallback request before advancing on timeout", async () => {
      const retriedModels: string[] = []
      const abortCalls: Array<{ path?: { id?: string } }> = []
      const never = new Promise<never>(() => {})

      const hook = createRuntimeFallbackHook(
        createMockPluginInput({
          session: {
            messages: async () => ({
              data: [{ info: { role: "user" }, parts: [{ type: "text", text: "hello" }] }],
            }),
            promptAsync: async (args: unknown) => {
              const model = (args as { body?: { model?: { providerID?: string; modelID?: string } } })?.body?.model
              if (model?.providerID && model?.modelID) {
                retriedModels.push(`${model.providerID}/${model.modelID}`)
              }

              if (retriedModels.length === 1) {
                await never
              }

              return {}
            },
            abort: async (args: unknown) => {
              abortCalls.push(args as { path?: { id?: string } })
              return {}
            },
          },
        }),
        {
          config: createMockConfig({ notify_on_fallback: false, timeout_seconds: 30 }),
          pluginConfig: createMockPluginConfigWithCategoryFallback([
            "github-copilot/claude-opus-4.6",
            "anthropic/claude-opus-4-6",
            "openai/gpt-5.2",
          ]),
          session_timeout_ms: 20,
        }
      )

      const sessionID = "test-session-timeout-abort-inflight"
      SessionCategoryRegistry.register(sessionID, "test")

      await hook.event({
        event: {
          type: "session.created",
          properties: { info: { id: sessionID, model: "google/gemini-2.5-pro" } },
        },
      })

      const sessionErrorPromise = hook.event({
        event: {
          type: "session.error",
          properties: {
            sessionID,
            error: {
              name: "ProviderAuthError",
              data: {
                providerID: "google",
                message:
                  "Google Generative AI API key is missing. Pass it using the 'apiKey' parameter or the GOOGLE_GENERATIVE_AI_API_KEY environment variable.",
              },
            },
          },
        },
      })

      await new Promise((resolve) => setTimeout(resolve, 50))

      expect(abortCalls.some((call) => call.path?.id === sessionID)).toBe(true)
      expect(retriedModels).toContain("github-copilot/claude-opus-4.6")
      expect(retriedModels).toContain("anthropic/claude-opus-4-6")

      void sessionErrorPromise
    })

    test("should not advance fallback after session.stop cancels timeout-driven retry", async () => {
      const retriedModels: string[] = []

      const hook = createRuntimeFallbackHook(
        createMockPluginInput({
          session: {
            messages: async () => ({
              data: [{ info: { role: "user" }, parts: [{ type: "text", text: "hello" }] }],
            }),
            promptAsync: async (args: unknown) => {
              const model = (args as { body?: { model?: { providerID?: string; modelID?: string } } })?.body?.model
              if (model?.providerID && model?.modelID) {
                retriedModels.push(`${model.providerID}/${model.modelID}`)
              }
              return {}
            },
          },
        }),
        {
          config: createMockConfig({ notify_on_fallback: false, timeout_seconds: 30 }),
          pluginConfig: createMockPluginConfigWithCategoryFallback([
            "github-copilot/claude-opus-4.6",
            "anthropic/claude-opus-4-6",
            "openai/gpt-5.2",
          ]),
          session_timeout_ms: 20,
        }
      )

      const sessionID = "test-session-stop-cancels-timeout-fallback"
      SessionCategoryRegistry.register(sessionID, "test")

      await hook.event({
        event: {
          type: "session.created",
          properties: { info: { id: sessionID, model: "google/gemini-2.5-pro" } },
        },
      })

      await hook.event({
        event: {
          type: "session.error",
          properties: {
            sessionID,
            error: {
              name: "ProviderAuthError",
              data: {
                providerID: "google",
                message:
                  "Google Generative AI API key is missing. Pass it using the 'apiKey' parameter or the GOOGLE_GENERATIVE_AI_API_KEY environment variable.",
              },
            },
          },
        },
      })

      expect(retriedModels).toContain("github-copilot/claude-opus-4.6")

      await hook.event({
        event: {
          type: "session.stop",
          properties: { sessionID },
        },
      })

      await new Promise((resolve) => setTimeout(resolve, 50))

      expect(retriedModels).toHaveLength(1)
    })

    test("should not trigger second fallback after successful assistant reply", async () => {
      const retriedModels: string[] = []
      const mockMessages = [
        { info: { role: "user" }, parts: [{ type: "text", text: "test" }] },
      ]

      const hook = createRuntimeFallbackHook(
        createMockPluginInput({
          session: {
            messages: async () => ({
              data: mockMessages,
            }),
            promptAsync: async (args: unknown) => {
              const model = (args as { body?: { model?: { providerID?: string; modelID?: string } } })?.body?.model
              if (model?.providerID && model?.modelID) {
                retriedModels.push(`${model.providerID}/${model.modelID}`)
              }
              return {}
            },
          },
        }),
        {
          config: createMockConfig({ notify_on_fallback: false, timeout_seconds: 30 }),
          pluginConfig: createMockPluginConfigWithCategoryFallback([
            "github-copilot/claude-opus-4.6",
            "openai/gpt-5.3-codex",
            "anthropic/claude-opus-4-6",
          ]),
          session_timeout_ms: 20,
        }
      )

      const sessionID = "test-session-success-clears-timeout"
      SessionCategoryRegistry.register(sessionID, "test")

      await hook.event({
        event: {
          type: "session.created",
          properties: { info: { id: sessionID, model: "google/gemini-2.5-pro" } },
        },
      })

      await hook.event({
        event: {
          type: "session.error",
          properties: {
            sessionID,
            error: {
              name: "ProviderAuthError",
              data: {
                providerID: "google",
                message:
                  "Google Generative AI API key is missing. Pass it using the 'apiKey' parameter or the GOOGLE_GENERATIVE_AI_API_KEY environment variable.",
              },
            },
          },
        },
      })

      expect(retriedModels).toEqual(["github-copilot/claude-opus-4.6"])

      await hook.event({
        event: {
          type: "message.updated",
          properties: {
            info: {
              sessionID,
              role: "assistant",
              model: "openai/gpt-5.3-codex",
            },
          },
        },
      })

      mockMessages.push({
        info: { role: "assistant" },
        parts: [{ type: "text", text: "Got it - I'm here." }],
      })

      await hook.event({
        event: {
          type: "message.updated",
          properties: {
            info: {
              sessionID,
              role: "assistant",
              model: "openai/gpt-5.3-codex",
              message: "Got it - I'm here.",
            },
          },
        },
      })

      await new Promise((resolve) => setTimeout(resolve, 50))

      expect(retriedModels).toEqual(["github-copilot/claude-opus-4.6"])
    })

    test("should not clear fallback timeout on assistant non-error update with Copilot retry signal", async () => {
      const retriedModels: string[] = []

      const hook = createRuntimeFallbackHook(
        createMockPluginInput({
          session: {
            messages: async () => ({
              data: [{ info: { role: "user" }, parts: [{ type: "text", text: "test" }] }],
            }),
            promptAsync: async (args: unknown) => {
              const model = (args as { body?: { model?: { providerID?: string; modelID?: string } } })?.body?.model
              if (model?.providerID && model?.modelID) {
                retriedModels.push(`${model.providerID}/${model.modelID}`)
              }
              return {}
            },
          },
        }),
        {
          config: createMockConfig({ notify_on_fallback: false, timeout_seconds: 30 }),
          pluginConfig: createMockPluginConfigWithCategoryFallback([
            "github-copilot/claude-opus-4.6",
            "openai/gpt-5.3-codex",
            "anthropic/claude-opus-4-6",
          ]),
          session_timeout_ms: 20,
        }
      )

      const sessionID = "test-session-copilot-retry-signal-no-error"
      SessionCategoryRegistry.register(sessionID, "test")

      await hook.event({
        event: {
          type: "session.created",
          properties: { info: { id: sessionID, model: "google/gemini-2.5-pro" } },
        },
      })

      await hook.event({
        event: {
          type: "session.error",
          properties: {
            sessionID,
            error: {
              name: "ProviderAuthError",
              data: {
                providerID: "google",
                message:
                  "Google Generative AI API key is missing. Pass it using the 'apiKey' parameter or the GOOGLE_GENERATIVE_AI_API_KEY environment variable.",
              },
            },
          },
        },
      })

      expect(retriedModels).toEqual(["github-copilot/claude-opus-4.6"])

      await hook.event({
        event: {
          type: "message.updated",
          properties: {
            info: {
              sessionID,
              role: "assistant",
              status: "Too Many Requests: quota exceeded [retrying in ~2 weeks attempt #1]",
            },
          },
        },
      })

      await new Promise((resolve) => setTimeout(resolve, 60))

      expect(retriedModels).toContain("openai/gpt-5.3-codex")
    })

    test("should not clear fallback timeout on assistant non-error update without user-visible content", async () => {
      const retriedModels: string[] = []

      const hook = createRuntimeFallbackHook(
        createMockPluginInput({
          session: {
            messages: async () => ({
              data: [{ info: { role: "user" }, parts: [{ type: "text", text: "test" }] }],
            }),
            promptAsync: async (args: unknown) => {
              const model = (args as { body?: { model?: { providerID?: string; modelID?: string } } })?.body?.model
              if (model?.providerID && model?.modelID) {
                retriedModels.push(`${model.providerID}/${model.modelID}`)
              }
              return {}
            },
          },
        }),
        {
          config: createMockConfig({ notify_on_fallback: false, timeout_seconds: 30 }),
          pluginConfig: createMockPluginConfigWithCategoryFallback([
            "github-copilot/claude-opus-4.6",
            "openai/gpt-5.3-codex",
            "anthropic/claude-opus-4-6",
          ]),
          session_timeout_ms: 20,
        }
      )

      const sessionID = "test-session-no-content-non-error-update"
      SessionCategoryRegistry.register(sessionID, "test")

      await hook.event({
        event: {
          type: "session.created",
          properties: { info: { id: sessionID, model: "google/gemini-2.5-pro" } },
        },
      })

      await hook.event({
        event: {
          type: "session.error",
          properties: {
            sessionID,
            error: {
              name: "ProviderAuthError",
              data: {
                providerID: "google",
                message:
                  "Google Generative AI API key is missing. Pass it using the 'apiKey' parameter or the GOOGLE_GENERATIVE_AI_API_KEY environment variable.",
              },
            },
          },
        },
      })

      expect(retriedModels).toEqual(["github-copilot/claude-opus-4.6"])

      await hook.event({
        event: {
          type: "message.updated",
          properties: {
            info: {
              sessionID,
              role: "assistant",
              model: "github-copilot/claude-opus-4.6",
            },
          },
        },
      })

      await new Promise((resolve) => setTimeout(resolve, 60))

      expect(retriedModels).toContain("openai/gpt-5.3-codex")
    })

    test("should not clear fallback timeout from info.message alone without persisted assistant text", async () => {
      const retriedModels: string[] = []

      const hook = createRuntimeFallbackHook(
        createMockPluginInput({
          session: {
            messages: async () => ({
              data: [{ info: { role: "user" }, parts: [{ type: "text", text: "test" }] }],
            }),
            promptAsync: async (args: unknown) => {
              const model = (args as { body?: { model?: { providerID?: string; modelID?: string } } })?.body?.model
              if (model?.providerID && model?.modelID) {
                retriedModels.push(`${model.providerID}/${model.modelID}`)
              }
              return {}
            },
          },
        }),
        {
          config: createMockConfig({ notify_on_fallback: false, timeout_seconds: 30 }),
          pluginConfig: createMockPluginConfigWithCategoryFallback([
            "github-copilot/claude-opus-4.6",
            "openai/gpt-5.3-codex",
            "anthropic/claude-opus-4-6",
          ]),
          session_timeout_ms: 20,
        }
      )

      const sessionID = "test-session-info-message-without-persisted-text"
      SessionCategoryRegistry.register(sessionID, "test")

      await hook.event({
        event: {
          type: "session.created",
          properties: { info: { id: sessionID, model: "google/gemini-2.5-pro" } },
        },
      })

      await hook.event({
        event: {
          type: "session.error",
          properties: {
            sessionID,
            error: {
              name: "ProviderAuthError",
              data: {
                providerID: "google",
                message:
                  "Google Generative AI API key is missing. Pass it using the 'apiKey' parameter or the GOOGLE_GENERATIVE_AI_API_KEY environment variable.",
              },
            },
          },
        },
      })

      expect(retriedModels).toEqual(["github-copilot/claude-opus-4.6"])

      await hook.event({
        event: {
          type: "message.updated",
          properties: {
            info: {
              sessionID,
              role: "assistant",
              message: "Thinking: retrying provider request...",
            },
          },
        },
      })

      await new Promise((resolve) => setTimeout(resolve, 60))

      expect(retriedModels).toContain("openai/gpt-5.3-codex")
    })

    test("should keep timeout armed when session.idle fires before fallback result", async () => {
      const retriedModels: string[] = []

      const hook = createRuntimeFallbackHook(
        createMockPluginInput({
          session: {
            messages: async () => ({
              data: [{ info: { role: "user" }, parts: [{ type: "text", text: "test" }] }],
            }),
            promptAsync: async (args: unknown) => {
              const model = (args as { body?: { model?: { providerID?: string; modelID?: string } } })?.body?.model
              if (model?.providerID && model?.modelID) {
                retriedModels.push(`${model.providerID}/${model.modelID}`)
              }
              return {}
            },
          },
        }),
        {
          config: createMockConfig({ notify_on_fallback: false, timeout_seconds: 30 }),
          pluginConfig: createMockPluginConfigWithCategoryFallback([
            "github-copilot/claude-opus-4.6",
            "openai/gpt-5.3-codex",
            "anthropic/claude-opus-4-6",
          ]),
          session_timeout_ms: 20,
        }
      )

      const sessionID = "test-session-idle-before-fallback-result"
      SessionCategoryRegistry.register(sessionID, "test")

      await hook.event({
        event: {
          type: "session.created",
          properties: { info: { id: sessionID, model: "google/gemini-2.5-pro" } },
        },
      })

      await hook.event({
        event: {
          type: "session.error",
          properties: {
            sessionID,
            error: {
              name: "ProviderAuthError",
              data: {
                providerID: "google",
                message:
                  "Google Generative AI API key is missing. Pass it using the 'apiKey' parameter or the GOOGLE_GENERATIVE_AI_API_KEY environment variable.",
              },
            },
          },
        },
      })

      expect(retriedModels).toEqual(["github-copilot/claude-opus-4.6"])

      await hook.event({
        event: {
          type: "session.idle",
          properties: { sessionID },
        },
      })

      await new Promise((resolve) => setTimeout(resolve, 60))

      expect(retriedModels).toContain("openai/gpt-5.3-codex")
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

      const output: { message: { model?: { providerID: string; modelID: string } }; parts: Array<{ type: string; text?: string }> } = {
        message: {},
        parts: [],
      }
      await hook["chat.message"]?.(
        { sessionID },
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
    function createMockPluginConfigWithAgentFallback(agentName: string, fallbackModels: string[]): OhMyOpenCodeConfig {
      return {
        agents: {
          [agentName]: {
            fallback_models: fallbackModels,
          },
        },
      }
    }

    test("should use agent-level fallback_models", async () => {
      const input = createMockPluginInput()
      const hook = createRuntimeFallbackHook(input, {
        config: createMockConfig({ notify_on_fallback: false }),
        pluginConfig: createMockPluginConfigWithAgentFallback("oracle", ["openai/gpt-5.2", "google/gemini-3-pro"]),
      })
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

      //#then - should prepare fallback to openai/gpt-5.2
      const fallbackLog = logCalls.find((c) => c.msg.includes("Preparing fallback"))
      expect(fallbackLog).toBeDefined()
      expect(fallbackLog?.data).toMatchObject({ from: "anthropic/claude-opus-4-5", to: "openai/gpt-5.2" })
    })

    test("should detect agent from sessionID pattern", async () => {
      const hook = createRuntimeFallbackHook(createMockPluginInput(), {
        config: createMockConfig({ notify_on_fallback: false }),
        pluginConfig: createMockPluginConfigWithAgentFallback("sisyphus", ["openai/gpt-5.2"]),
      })
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

      //#then - should detect sisyphus from sessionID and use its fallback
      const fallbackLog = logCalls.find((c) => c.msg.includes("Preparing fallback"))
      expect(fallbackLog).toBeDefined()
      expect(fallbackLog?.data).toMatchObject({ to: "openai/gpt-5.2" })
    })

    test("should preserve resolved agent during auto-retry", async () => {
      const promptCalls: Array<Record<string, unknown>> = []
      const hook = createRuntimeFallbackHook(
        createMockPluginInput({
          session: {
            messages: async () => ({
              data: [
                {
                  info: { role: "user" },
                  parts: [{ type: "text", text: "test" }],
                },
              ],
            }),
            promptAsync: async (args: unknown) => {
              promptCalls.push(args as Record<string, unknown>)
              return {}
            },
          },
        }),
        {
          config: createMockConfig({ notify_on_fallback: false }),
          pluginConfig: createMockPluginConfigWithAgentFallback("prometheus", ["github-copilot/claude-opus-4.6"]),
        },
      )
      const sessionID = "test-preserve-agent-on-retry"

      await hook.event({
        event: {
          type: "session.error",
          properties: {
            sessionID,
            model: "anthropic/claude-opus-4-6",
            error: { statusCode: 503, message: "Service unavailable" },
            agent: "prometheus",
          },
        },
      })

      expect(promptCalls.length).toBe(1)
      const callBody = promptCalls[0]?.body as Record<string, unknown>
      expect(callBody?.agent).toBe("prometheus")
      expect(callBody?.model).toEqual({ providerID: "github-copilot", modelID: "claude-opus-4.6" })
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
