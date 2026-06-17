import { describe, expect, test, beforeEach, afterEach, mock } from "bun:test"
import type { RuntimeFallbackConfig, MatrixxConfig } from "../../config"
import * as loggerModule from "../../shared/logger"
import { SessionCategoryRegistry } from "./session-category-registry"

type RuntimeFallbackModule = typeof import("./hook")

describe("runtime-fallback", () => {
  let logCalls: Array<{ msg: string; data?: unknown }>
  let toastCalls: Array<{ title: string; message: string; variant: string }>
  let createRuntimeFallbackHook: RuntimeFallbackModule["createRuntimeFallbackHook"]

  beforeEach(async () => {
    mock.restore()
    logCalls = []
    toastCalls = []
    SessionCategoryRegistry.clear()

    const cacheBuster = `${Date.now()}-${Math.random()}`

    mock.module("../../shared/logger", () => ({
      ...loggerModule,
      log: (msg: string, data?: unknown) => {
        logCalls.push({ msg, data })
      },
    }))

    const runtimeFallbackModule: RuntimeFallbackModule = await import(`./hook?test=${cacheBuster}`)
    createRuntimeFallbackHook = runtimeFallbackModule.createRuntimeFallbackHook
  })

  afterEach(() => {
    SessionCategoryRegistry.clear()
    mock.restore()
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
    } as unknown as Parameters<RuntimeFallbackModule["createRuntimeFallbackHook"]>[0]
  }

  function createMockConfig(overrides?: Partial<RuntimeFallbackConfig>): RuntimeFallbackConfig {
    return {
      enabled: true,
      retry_on_errors: [429, 503, 529],
      max_fallback_attempts: 3,
      cooldown_seconds: 60,
      timeout_seconds: 30,
      notify_on_fallback: true,
      ...overrides,
    }
  }

  function createMockPluginConfigWithCategoryFallback(fallbackModels: string[]): MatrixxConfig {
    return {
      categories: {
        test: {
          fallback_models: fallbackModels,
        },
      },
    }
  }

  function createMockPluginConfigWithCategoryModel(
    categoryName: string,
    model: string,
    fallbackModels: string[],
    variant?: string,
  ): MatrixxConfig {
    return {
      categories: {
        [categoryName]: {
          model,
          fallback_models: fallbackModels,
          ...(variant ? { variant } : {}),
        },
      },
    }
  }

  describe("session.error handling", () => {
    test("should detect retryable error with status code 429", async () => {
      //#given
      const hook = createRuntimeFallbackHook(createMockPluginInput(), { config: createMockConfig() })
      const sessionID = "test-session-123"

      //#when
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

      //#then
      const fallbackLog = logCalls.find((c) => c.msg.includes("session.error received"))
      expect(fallbackLog).toBeDefined()
      expect(fallbackLog?.data).toMatchObject({ sessionID, statusCode: 429 })
    })

    test("should detect retryable error with status code 503", async () => {
      //#given
      const hook = createRuntimeFallbackHook(createMockPluginInput(), { config: createMockConfig() })
      const sessionID = "test-session-503"

      //#when
      await hook.event({
        event: {
          type: "session.created",
          properties: { info: { id: sessionID, model: "openai/gpt-5.4" } },
        },
      })

      await hook.event({
        event: {
          type: "session.error",
          properties: { sessionID, error: { statusCode: 503, message: "Service unavailable" } },
        },
      })

      //#then
      const errorLog = logCalls.find((c) => c.msg.includes("session.error received"))
      expect(errorLog).toBeDefined()
    })

    test("should skip non-retryable errors", async () => {
      //#given
      const hook = createRuntimeFallbackHook(createMockPluginInput(), { config: createMockConfig() })
      const sessionID = "test-session-400"

      //#when
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

      //#then
      const skipLog = logCalls.find((c) => c.msg.includes("Error not retryable"))
      expect(skipLog).toBeDefined()
    })

    test("should log missing API key errors with classification details", async () => {
      //#given
      const hook = createRuntimeFallbackHook(createMockPluginInput(), { config: createMockConfig() })
      const sessionID = "test-session-missing-api-key"

      //#when
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

      //#then
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
      //#given
      const hook = createRuntimeFallbackHook(createMockPluginInput(), {
        config: createMockConfig({ notify_on_fallback: false }),
        pluginConfig: createMockPluginConfigWithCategoryFallback(["openai/gpt-5.4"]),
      })
      const sessionID = "test-session-missing-api-key-fallback"
      SessionCategoryRegistry.register(sessionID, "test")

      //#when
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

      //#then
      const fallbackLog = logCalls.find((c) => c.msg.includes("Preparing fallback"))
      expect(fallbackLog).toBeDefined()
      expect(fallbackLog?.data).toMatchObject({ from: "google/gemini-2.5-pro", to: "openai/gpt-5.4" })
    })

    test("should NOT trigger fallback for quota exhaustion without auto-retry signal", async () => {
      //#given
      const hook = createRuntimeFallbackHook(createMockPluginInput(), {
        config: createMockConfig({ notify_on_fallback: false }),
        pluginConfig: createMockPluginConfigWithCategoryFallback(["zai-coding-plan/glm-5.1"]),
      })
      const sessionID = "test-session-usage-limit"
      SessionCategoryRegistry.register(sessionID, "test")

      //#when
      await hook.event({
        event: {
          type: "session.created",
          properties: { info: { id: sessionID, model: "kimi-for-coding/k2p5" } },
        },
      })

      await hook.event({
        event: {
          type: "session.error",
          properties: {
            sessionID,
            error: { message: "You've reached your usage limit for this month. Please upgrade to continue." },
          },
        },
      })

      //#then
      const fallbackLog = logCalls.find((c) => c.msg.includes("Preparing fallback"))
      expect(fallbackLog).toBeUndefined()

      const skipLog = logCalls.find((c) => c.msg.includes("Error not retryable"))
      expect(skipLog).toBeDefined()
    })

    test("should log when no fallback models configured", async () => {
      //#given
      const hook = createRuntimeFallbackHook(createMockPluginInput(), {
        config: createMockConfig(),
        pluginConfig: {},
      })
      const sessionID = "test-session-no-fallbacks"

      //#when
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

      //#then
      const noFallbackLog = logCalls.find((c) => c.msg.includes("No fallback models configured"))
      expect(noFallbackLog).toBeDefined()
    })
  })

  describe("disabled hook", () => {
    test("should not process events when disabled", async () => {
      //#given
      const hook = createRuntimeFallbackHook(createMockPluginInput(), {
        config: createMockConfig({ enabled: false }),
      })
      const sessionID = "test-session-disabled"

      //#when
      await hook.event({
        event: {
          type: "session.error",
          properties: { sessionID, error: { statusCode: 429 } },
        },
      })

      //#then
      const sessionErrorLog = logCalls.find((c) => c.msg.includes("session.error received"))
      expect(sessionErrorLog).toBeUndefined()
    })
  })

  describe("session lifecycle", () => {
    test("should create state on session.created", async () => {
      //#given
      const hook = createRuntimeFallbackHook(createMockPluginInput(), { config: createMockConfig() })
      const sessionID = "test-session-create"
      const model = "anthropic/claude-opus-4-5"

      //#when
      await hook.event({
        event: {
          type: "session.created",
          properties: { info: { id: sessionID, model } },
        },
      })

      //#then
      const createLog = logCalls.find((c) => c.msg.includes("Session created with model"))
      expect(createLog).toBeDefined()
      expect(createLog?.data).toMatchObject({ sessionID, model })
    })

    test("should cleanup state on session.deleted", async () => {
      //#given
      const hook = createRuntimeFallbackHook(createMockPluginInput(), { config: createMockConfig() })
      const sessionID = "test-session-delete"

      //#when
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

      //#then
      const deleteLog = logCalls.find((c) => c.msg.includes("Cleaning up session state"))
      expect(deleteLog).toBeDefined()
      expect(deleteLog?.data).toMatchObject({ sessionID })
    })

    test("should handle session.error without prior session.created", async () => {
      //#given
      const hook = createRuntimeFallbackHook(createMockPluginInput(), { config: createMockConfig() })
      const sessionID = "test-session-no-create"

      //#when
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

      //#then
      const errorLog = logCalls.find((c) => c.msg.includes("session.error received"))
      expect(errorLog).toBeDefined()
    })
  })

  describe("message.updated handling", () => {
    test("should handle assistant message errors", async () => {
      //#given
      const hook = createRuntimeFallbackHook(createMockPluginInput(), { config: createMockConfig() })
      const sessionID = "test-message-updated"

      //#when
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

      //#then
      const errorLog = logCalls.find((c) => c.msg.includes("message.updated with assistant error"))
      expect(errorLog).toBeDefined()
    })

    test("should skip non-assistant message errors", async () => {
      //#given
      const hook = createRuntimeFallbackHook(createMockPluginInput(), { config: createMockConfig() })
      const sessionID = "test-message-user"

      //#when
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

      //#then
      const errorLog = logCalls.find((c) => c.msg.includes("message.updated with assistant error"))
      expect(errorLog).toBeUndefined()
    })

    test("should trigger fallback on Copilot auto-retry signal in message.updated", async () => {
      //#given
      const hook = createRuntimeFallbackHook(createMockPluginInput(), {
        config: createMockConfig({ notify_on_fallback: false }),
        pluginConfig: createMockPluginConfigWithCategoryFallback(["openai/gpt-5.4"]),
      })

      const sessionID = "test-session-copilot-auto-retry"
      SessionCategoryRegistry.register(sessionID, "test")

      //#when
      await hook.event({
        event: {
          type: "session.created",
          properties: { info: { id: sessionID, model: "github-copilot/claude-opus-4.7" } },
        },
      })

      await hook.event({
        event: {
          type: "message.updated",
          properties: {
            info: {
              sessionID,
              role: "assistant",
              model: "github-copilot/claude-opus-4.7",
              status:
                "Too Many Requests: quota exceeded [retrying in ~2 weeks attempt #1]",
            },
          },
        },
      })

      //#then
      const signalLog = logCalls.find((c) => c.msg.includes("Detected provider auto-retry signal"))
      expect(signalLog).toBeDefined()

      const fallbackLog = logCalls.find((c) => c.msg.includes("Preparing fallback"))
      expect(fallbackLog).toBeDefined()
      expect(fallbackLog?.data).toMatchObject({ from: "github-copilot/claude-opus-4.7", to: "openai/gpt-5.4" })
    })

    test("should NOT trigger fallback on auto-retry signal when timeout_seconds is 0", async () => {
      //#given
      const hook = createRuntimeFallbackHook(createMockPluginInput(), {
        config: createMockConfig({ notify_on_fallback: false, timeout_seconds: 0 }),
        pluginConfig: createMockPluginConfigWithCategoryFallback(["anthropic/claude-opus-4-7"]),
      })

      const sessionID = "test-session-auto-retry-timeout-disabled"
      SessionCategoryRegistry.register(sessionID, "test")

      //#when
      await hook.event({
        event: {
          type: "session.created",
          properties: { info: { id: sessionID, model: "openai/gpt-5.3-codex" } },
        },
      })

      await hook.event({
        event: {
          type: "message.updated",
          properties: {
            info: {
              sessionID,
              role: "assistant",
              model: "openai/gpt-5.3-codex",
              status: "The usage limit has been reached [retrying in 27s attempt #6]",
            },
          },
        },
      })

      //#then
      const signalLog = logCalls.find((c) => c.msg.includes("Detected provider auto-retry signal"))
      expect(signalLog).toBeUndefined()

      const fallbackLog = logCalls.find((c) => c.msg.includes("Preparing fallback"))
      expect(fallbackLog).toBeUndefined()
    })
  })

  describe("session.status auto-retry signal", () => {
    test("should trigger fallback on session.status auto-retry signal", async () => {
      //#given
      const promptCalls: unknown[] = []
      const hook = createRuntimeFallbackHook(
        createMockPluginInput({
          session: {
            messages: async () => ({
              data: [
                {
                  info: { role: "user" },
                  parts: [{ type: "text", text: "continue" }],
                },
              ],
            }),
            promptAsync: async (args) => {
              promptCalls.push(args)
              return {}
            },
          },
        }),
        {
          config: createMockConfig({ notify_on_fallback: false }),
          pluginConfig: createMockPluginConfigWithCategoryFallback(["openai/gpt-5.2"]),
        }
      )

      const sessionID = "test-session-status-auto-retry"
      SessionCategoryRegistry.register(sessionID, "test")

      //#when
      await hook.event({
        event: {
          type: "session.created",
          properties: { info: { id: sessionID, model: "quotio/claude-opus-4-7" } },
        },
      })

      await hook.event({
        event: {
          type: "session.status",
          properties: {
            sessionID,
            status: {
              type: "retry",
              next: 476,
              attempt: 1,
              message: "All credentials for model claude-opus-4-7 are cooling down [retrying in 7m 56s attempt #1]",
            },
          },
        },
      })

      //#then
      const signalLog = logCalls.find((c) => c.msg.includes("Detected provider auto-retry signal in session.status"))
      expect(signalLog).toBeDefined()

      const fallbackLog = logCalls.find((c) => c.msg.includes("Preparing fallback"))
      expect(fallbackLog).toBeDefined()
      expect(fallbackLog?.data).toMatchObject({ from: "quotio/claude-opus-4-7", to: "openai/gpt-5.2" })
      expect(promptCalls.length).toBe(1)
    })

    test("should deduplicate session.status countdown updates for the same retry attempt", async () => {
      //#given
      const promptCalls: unknown[] = []
      const hook = createRuntimeFallbackHook(
        createMockPluginInput({
          session: {
            messages: async () => ({
              data: [
                {
                  info: { role: "user" },
                  parts: [{ type: "text", text: "continue" }],
                },
              ],
            }),
            promptAsync: async (args) => {
              promptCalls.push(args)
              return {}
            },
          },
        }),
        {
          config: createMockConfig({ notify_on_fallback: false }),
          pluginConfig: createMockPluginConfigWithCategoryFallback(["openai/gpt-5.2"]),
        }
      )

      const sessionID = "test-session-status-dedup"
      SessionCategoryRegistry.register(sessionID, "test")

      //#when
      await hook.event({
        event: {
          type: "session.created",
          properties: { info: { id: sessionID, model: "quotio/claude-opus-4-7" } },
        },
      })

      await hook.event({
        event: {
          type: "session.status",
          properties: {
            sessionID,
            status: {
              type: "retry",
              next: 476,
              attempt: 1,
              message: "All credentials for model claude-opus-4-7 are cooling down [retrying in 7m 56s attempt #1]",
            },
          },
        },
      })

      await hook.event({
        event: {
          type: "session.status",
          properties: {
            sessionID,
            status: {
              type: "retry",
              next: 475,
              attempt: 1,
              message: "All credentials for model claude-opus-4-7 are cooling down [retrying in 7m 55s attempt #1]",
            },
          },
        },
      })

      //#then
      expect(promptCalls.length).toBe(1)
    })
  })

  describe("category model bootstrap", () => {
    test("should bootstrap session.error fallback from session category model and preserve variant", async () => {
      //#given
      const promptCalls: Array<Record<string, unknown>> = []
      const hook = createRuntimeFallbackHook(
        createMockPluginInput({
          session: {
            messages: async () => ({
              data: [{ info: { role: "user" }, parts: [{ type: "text", text: "continue" }] }],
            }),
            promptAsync: async (args) => {
              promptCalls.push(args as Record<string, unknown>)
              return {}
            },
          },
        }),
        {
          config: createMockConfig({ notify_on_fallback: false }),
          pluginConfig: createMockPluginConfigWithCategoryModel(
            "quick",
            "anthropic/claude-haiku-4-5",
            ["openai/gpt-5.4(high)"],
          ),
        },
      )
      const sessionID = "test-session-category-bootstrap-session-error"
      SessionCategoryRegistry.register(sessionID, "quick")

      //#when
      await hook.event({
        event: {
          type: "session.error",
          properties: {
            sessionID,
            error: { statusCode: 429, message: "Rate limit exceeded" },
          },
        },
      })

      //#then
      expect(promptCalls).toHaveLength(1)
      const promptBody = promptCalls[0]?.body as {
        model?: { providerID?: string; modelID?: string }
        variant?: string
      } | undefined
      expect(promptBody?.model).toEqual({ providerID: "openai", modelID: "gpt-5.4" })
      expect(promptBody?.variant).toBe("high")

      const bootstrapLog = logCalls.find((call) =>
        call.msg.includes("Derived model from session category config for session.error"),
      )
      expect(bootstrapLog?.data).toMatchObject({
        sessionID,
        category: "quick",
        model: "anthropic/claude-haiku-4-5",
      })
    })
  })

  describe("custom error codes", () => {
    test("should support custom retry_on_errors configuration", async () => {
      //#given
      const hook = createRuntimeFallbackHook(createMockPluginInput(), {
        config: createMockConfig({ retry_on_errors: [500, 502] }),
      })
      const sessionID = "test-session-custom"

      //#when
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

      //#then
      const errorLog = logCalls.find((c) => c.msg.includes("session.error received"))
      expect(errorLog).toBeDefined()
    })
  })
})
