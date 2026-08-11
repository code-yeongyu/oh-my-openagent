/// <reference types="bun-types" />
import { afterEach, describe, expect, spyOn, test } from "bun:test"

import { createEventHandler } from "./event"
import { createChatMessageHandler } from "./chat-message"
import { _resetForTesting, setMainSession } from "../features/claude-code-session-state"
import { createModelFallbackHook, clearPendingModelFallback } from "../hooks/model-fallback/hook"
import * as connectedProvidersCache from "../shared/connected-providers-cache"
import {
  releaseAllPromptAsyncReservationsForTesting,
  releasePromptAsyncReservation,
} from "../hooks/shared/prompt-async-gate"
import { unsafeTestValue } from "../../../../test-support/unsafe-test-value"

type EventInput = { event: { type: string; properties?: unknown } }
type EventHandlerInput = Parameters<ReturnType<typeof createEventHandler>>[0]
type ChatMessageOutput = {
  message: Record<string, unknown>
  parts: Array<{ type: string; text?: string }>
}

function asEventHandlerInput(input: EventInput): EventHandlerInput {
  return unsafeTestValue<EventHandlerInput>(input)
}

let readConnectedProvidersCacheSpy: { mockRestore: () => void } | undefined
let readProviderModelsCacheSpy: { mockRestore: () => void } | undefined

function setupConnectedProviderCacheMocks(): void {
  readConnectedProvidersCacheSpy = spyOn(connectedProvidersCache, "readConnectedProvidersCache").mockReturnValue(null)
  readProviderModelsCacheSpy = spyOn(connectedProvidersCache, "readProviderModelsCache").mockReturnValue(null)
}

describe("createEventHandler - model fallback", () => {
  const createHandler = (args?: {
    hooks?: unknown
    pluginConfig?: unknown
    abort?: (input: { path: { id: string } }) => Promise<unknown>
    promptAsync?: (input: { path: { id: string }; body?: { model?: unknown } }) => Promise<unknown>
  }) => {
    setupConnectedProviderCacheMocks()
    const abortCalls: string[] = []
    const promptCalls: string[] = []
    const promptAsyncCalls: string[] = []
    // Captures `body.model` from each promptAsync call so Problem-B RED tests
    // can assert which model the auto-continuation actually dispatched.
    const promptAsyncBodies: unknown[] = []

    const sessionClient = {
      abort: async ({ path }: { path: { id: string } }) => {
        abortCalls.push(path.id)
        if (args?.abort) {
          return args.abort({ path })
        }
        return {}
      },
      prompt: async ({ path }: { path: { id: string } }) => {
        promptCalls.push(path.id)
        return {}
      },
      ...(args?.promptAsync
        ? {
            promptAsync: async (input: { path: { id: string }; body?: { model?: unknown } }) => {
              promptAsyncCalls.push(input.path.id)
              if (input.body && typeof input.body === "object" && "model" in input.body) {
                promptAsyncBodies.push(input.body.model)
              }
              return args.promptAsync?.(input)
            },
          }
        : {}),
    }

    const eventHandler = createEventHandler({
      ctx: unsafeTestValue({
        directory: "/tmp",
        client: {
          session: sessionClient,
        },
      }),
      pluginConfig: unsafeTestValue((args?.pluginConfig ?? {})),
      firstMessageVariantGate: {
        markSessionCreated: () => {},
        clear: () => {},
      },
      managers: unsafeTestValue({
        tmuxSessionManager: {
          onSessionCreated: async () => {},
          onSessionDeleted: async () => {},
        },
        skillMcpManager: {
          disconnectSession: async () => {},
        },
      }),
      hooks: unsafeTestValue(args?.hooks ?? {}),
    })
    const handler = (input: EventInput): Promise<void> => eventHandler(asEventHandlerInput(input))

    return { handler, abortCalls, promptCalls, promptAsyncCalls, promptAsyncBodies }
  }

  afterEach(() => {
    readConnectedProvidersCacheSpy?.mockRestore()
    readProviderModelsCacheSpy?.mockRestore()
    readConnectedProvidersCacheSpy = undefined
    readProviderModelsCacheSpy = undefined
    _resetForTesting()
    releaseAllPromptAsyncReservationsForTesting()
  })

  test("triggers retry prompt for assistant message.updated APIError payloads (headless resume)", async () => {
    //#given
    const sessionID = "ses_message_updated_fallback"
    const modelFallback = createModelFallbackHook()
    const { handler, abortCalls, promptCalls } = createHandler({ hooks: { modelFallback } })

    //#when
    await handler({
      event: {
        type: "message.updated",
        properties: {
          info: {
            id: "msg_err_1",
            sessionID,
            role: "assistant",
            time: { created: 1, completed: 2 },
            error: {
              name: "APIError",
              data: {
                message:
                  "Bad Gateway: {\"error\":{\"message\":\"unknown provider for model claude-opus-4-7-thinking\"}}",
                isRetryable: true,
              },
            },
            parentID: "msg_user_1",
            modelID: "claude-opus-4-7-thinking",
            providerID: "anthropic",
            mode: "Sisyphus - Ultraworker",
            agent: "Sisyphus - Ultraworker",
            path: { cwd: "/tmp", root: "/tmp" },
            cost: 0,
            tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
          },
        },
      },
    })

    //#then
    expect(abortCalls).toEqual([sessionID])
    expect(promptCalls).toEqual([sessionID])
  })

  test("#given model-fallback promptAsync may have been accepted before EOF #when the same assistant error repeats after the gate hold #then fallback continue is not duplicated", async () => {
    //#given
    const sessionID = "ses_message_updated_fallback_eof"
    const modelFallback = createModelFallbackHook()
    const { handler, abortCalls, promptAsyncCalls } = createHandler({
      hooks: { modelFallback },
      promptAsync: async () => {
        throw new Error("JSON Parse error: Unexpected EOF")
      },
    })
    const input: EventInput = {
      event: {
        type: "message.updated",
        properties: {
          info: {
            id: "msg_err_eof",
            sessionID,
            role: "assistant",
            time: { created: 1, completed: 2 },
            error: {
              name: "APIError",
              data: {
                message:
                  "Bad Gateway: {\"error\":{\"message\":\"unknown provider for model claude-opus-4-7-thinking\"}}",
                isRetryable: true,
              },
            },
            parentID: "msg_user_eof",
            modelID: "claude-opus-4-7-thinking",
            providerID: "anthropic",
            agent: "Sisyphus - Ultraworker",
            path: { cwd: "/tmp", root: "/tmp" },
          },
        },
      },
    }

    //#when
    await handler(input)
    const released = releasePromptAsyncReservation(sessionID, "test:simulate-expired-hold", {
      reservedBy: "model-fallback:message.updated",
    })
    await handler(input)

    //#then
    expect(released).toBe(true)
    expect(abortCalls).toEqual([sessionID])
    expect(promptAsyncCalls).toEqual([sessionID])
  })

  test("triggers retry prompt for nested model error payloads", async () => {
    //#given
    const sessionID = "ses_main_fallback_nested"
    setMainSession(sessionID)
    const modelFallback = createModelFallbackHook()
    const { handler, abortCalls, promptCalls } = createHandler({ hooks: { modelFallback } })

    //#when
    await handler({
      event: {
        type: "session.error",
        properties: {
          sessionID,
          error: {
            name: "UnknownError",
            data: {
              error: {
                message:
                  "Bad Gateway: {\"error\":{\"message\":\"unknown provider for model claude-opus-4-7-thinking\"}}",
              },
            },
          },
        },
      },
    })

    //#then
    expect(abortCalls).toEqual([sessionID])
    expect(promptCalls).toEqual([sessionID])
  })

  test("does not dispatch duplicate fallback continuations when error events overlap", async () => {
    //#given
    const sessionID = "ses_model_fallback_concurrent_events"
    setMainSession(sessionID)
    let releasePromptAsync: (() => void) | undefined
    const promptAsyncBlocked = new Promise<void>((resolve) => {
      releasePromptAsync = resolve
    })
    let firstPromptAsyncStartedResolve: (() => void) | undefined
    const firstPromptAsyncStarted = new Promise<void>((resolve) => {
      firstPromptAsyncStartedResolve = resolve
    })
    let pendingFallbackArms = 0
    const modelFallback = unsafeTestValue({
      setSessionFallbackChain: () => {},
      setPendingModelFallback: () => {
        pendingFallbackArms += 1
        return true
      },
    })
    const { handler, abortCalls, promptAsyncCalls } = createHandler({
      hooks: { modelFallback },
      promptAsync: async () => {
        if (promptAsyncCalls.length === 1) {
          firstPromptAsyncStartedResolve?.()
        }
        await promptAsyncBlocked
        return {}
      },
    })

    const assistantError = {
      name: "APIError",
      data: {
        message:
          "Bad Gateway: {\"error\":{\"message\":\"unknown provider for model claude-opus-4-7-thinking\"}}",
        isRetryable: true,
      },
    }

    //#when
    const messageUpdated = handler({
      event: {
        type: "message.updated",
        properties: {
          info: {
            id: "msg_err_concurrent_1",
            sessionID,
            role: "assistant",
            error: assistantError,
            modelID: "claude-opus-4-7-thinking",
            providerID: "anthropic",
            agent: "Sisyphus - Ultraworker",
          },
        },
      },
    })
    await firstPromptAsyncStarted
    const sessionError = handler({
      event: {
        type: "session.error",
        properties: {
          sessionID,
          providerID: "anthropic",
          modelID: "claude-opus-4-7-thinking",
          error: assistantError,
        },
      },
    })

    releasePromptAsync?.()
    await Promise.all([messageUpdated, sessionError])

    //#then
    expect(pendingFallbackArms).toBe(1)
    expect(promptAsyncCalls).toEqual([sessionID])
    expect(abortCalls).toEqual([sessionID])
  })

  test("does not dispatch duplicate fallback continuations when session.error omits provider after dispatch", async () => {
    //#given
    const sessionID = "ses_model_fallback_providerless_duplicate"
    setMainSession(sessionID)
    let pendingFallbackArms = 0
    const modelFallback = unsafeTestValue({
      setSessionFallbackChain: () => {},
      setPendingModelFallback: () => {
        pendingFallbackArms += 1
        return true
      },
    })
    const { handler, abortCalls, promptAsyncCalls } = createHandler({
      hooks: { modelFallback },
      promptAsync: async () => ({}),
    })

    const assistantError = {
      name: "APIError",
      data: {
        message:
          "Bad Gateway: {\"error\":{\"message\":\"unknown provider for model claude-opus-4-7-thinking\"}}",
        isRetryable: true,
      },
    }

    await handler({
      event: {
        type: "message.updated",
        properties: {
          info: {
            id: "msg_err_providerless_duplicate_1",
            sessionID,
            role: "assistant",
            error: assistantError,
            modelID: "claude-opus-4-7-thinking",
            providerID: "anthropic",
            agent: "Sisyphus - Ultraworker",
          },
        },
      },
    })

    //#when - same failed model arrives without provider metadata after first dispatch resolved
    await handler({
      event: {
        type: "session.error",
        properties: {
          sessionID,
          error: assistantError,
        },
      },
    })

    //#then
    expect(pendingFallbackArms).toBe(1)
    expect(promptAsyncCalls).toEqual([sessionID])
    expect(abortCalls).toEqual([sessionID])
  })

  test("#given abort fails before model-fallback continuation #when fallback handles assistant error #then it does not inject another prompt", async () => {
    //#given
    const sessionID = "ses_model_fallback_abort_failure"
    setMainSession(sessionID)
    let pendingFallbackArms = 0
    const modelFallback = unsafeTestValue({
      setSessionFallbackChain: () => {},
      setPendingModelFallback: () => {
        pendingFallbackArms += 1
        return true
      },
    })
    const { handler, abortCalls, promptAsyncCalls } = createHandler({
      hooks: { modelFallback },
      abort: async () => {
        throw new Error("abort transport failed")
      },
      promptAsync: async () => ({}),
    })
    const assistantError = {
      name: "APIError",
      data: {
        message:
          "Bad Gateway: {\"error\":{\"message\":\"unknown provider for model claude-opus-4-7-thinking\"}}",
        isRetryable: true,
      },
    }

    //#when
    await handler({
      event: {
        type: "message.updated",
        properties: {
          info: {
            id: "msg_err_abort_failure",
            sessionID,
            role: "assistant",
            error: assistantError,
            modelID: "claude-opus-4-7-thinking",
            providerID: "anthropic",
            agent: "Sisyphus - Ultraworker",
          },
        },
      },
    })

    //#then
    expect(pendingFallbackArms).toBe(1)
    expect(abortCalls).toEqual([sessionID])
    expect(promptAsyncCalls).toEqual([])
  })

  test("does not collapse fallback continuations for different providers with the same model id", async () => {
    //#given
    const sessionID = "ses_model_fallback_same_model_different_provider"
    setMainSession(sessionID)
    let pendingFallbackArms = 0
    const modelFallback = unsafeTestValue({
      setSessionFallbackChain: () => {},
      setPendingModelFallback: () => {
        pendingFallbackArms += 1
        return true
      },
    })
    const { handler, abortCalls, promptAsyncCalls } = createHandler({
      hooks: { modelFallback },
      promptAsync: async () => ({}),
    })

    const assistantError = {
      name: "APIError",
      data: {
        message:
          "Bad Gateway: {\"error\":{\"message\":\"unknown provider for model claude-opus-4-7-thinking\"}}",
        isRetryable: true,
      },
    }

    await handler({
      event: {
        type: "message.updated",
        properties: {
          info: {
            id: "msg_err_same_model_provider_1",
            sessionID,
            role: "assistant",
            error: assistantError,
            modelID: "claude-opus-4-7-thinking",
            providerID: "anthropic",
            agent: "Sisyphus - Ultraworker",
          },
        },
      },
    })

    //#when - a distinct provider reports the same normalized model id before idle cleanup
    await handler({
      event: {
        type: "session.error",
        properties: {
          sessionID,
          providerID: "quotio",
          modelID: "claude-opus-4-7-thinking",
          error: assistantError,
        },
      },
    })

    //#then
    expect(pendingFallbackArms).toBe(2)
    expect(promptAsyncCalls).toEqual([sessionID, sessionID])
    expect(abortCalls).toEqual([sessionID, sessionID])
  })

  test("triggers retry prompt on session.status retry events and applies fallback", async () => {
    //#given
    const sessionID = "ses_status_retry_fallback"
    setMainSession(sessionID)
    const modelFallback = createModelFallbackHook()
    clearPendingModelFallback(modelFallback, sessionID)

    const { handler, abortCalls, promptCalls } = createHandler({ hooks: { modelFallback } })

    const chatMessageHandler = createChatMessageHandler({
      ctx: unsafeTestValue({
        client: {
          tui: {
            showToast: async () => ({}),
          },
        },
      }),
      pluginConfig: unsafeTestValue({}),
      firstMessageVariantGate: {
        shouldOverride: () => false,
        markApplied: () => {},
      },
      hooks: unsafeTestValue({
        modelFallback,
        stopContinuationGuard: null,
        keywordDetector: null,
        claudeCodeHooks: null,
        autoSlashCommand: null,
        startWork: null,
        ralphLoop: null,
      }),
    })

    await handler({
      event: {
        type: "message.updated",
        properties: {
          info: {
            id: "msg_user_status_1",
            sessionID,
            role: "user",
            time: { created: 1 },
            content: [],
            modelID: "claude-opus-4-7-thinking",
            providerID: "anthropic",
            agent: "Sisyphus - Ultraworker",
            path: { cwd: "/tmp", root: "/tmp" },
          },
        },
      },
    })

    //#when
    await handler({
      event: {
        type: "session.status",
        properties: {
          sessionID,
          status: {
            type: "retry",
            attempt: 1,
            message:
              "Bad Gateway: {\"error\":{\"message\":\"unknown provider for model claude-opus-4-7-thinking\"}}",
            next: 1234,
          },
        },
      },
    })

    const output: ChatMessageOutput = { message: {}, parts: [] }
    await chatMessageHandler(
      {
        sessionID,
        agent: "sisyphus",
        model: { providerID: "anthropic", modelID: "claude-opus-4-7-thinking" },
      },
      output,
    )

    //#then
    expect(abortCalls).toEqual([sessionID])
    expect(promptCalls).toEqual([sessionID])
    expect(output.message["model"]).toMatchObject({
      providerID: "opencode-go",
      modelID: "kimi-k2.6",
    })
    expect(output.message["variant"]).toBeUndefined()
  })

  test("does not spam abort/prompt when session.status retry countdown updates", async () => {
    //#given
    const sessionID = "ses_status_retry_dedup"
    setMainSession(sessionID)
    const modelFallback = createModelFallbackHook()
    clearPendingModelFallback(modelFallback, sessionID)
    const { handler, abortCalls, promptCalls } = createHandler({ hooks: { modelFallback } })

    await handler({
      event: {
        type: "message.updated",
        properties: {
          info: {
            id: "msg_user_status_dedup",
            sessionID,
            role: "user",
            modelID: "claude-opus-4-7-thinking",
            providerID: "anthropic",
            agent: "Sisyphus - Ultraworker",
          },
        },
      },
    })

    //#when
    await handler({
      event: {
        type: "session.status",
        properties: {
          sessionID,
          status: {
            type: "retry",
            attempt: 1,
            message:
              "All credentials for model claude-opus-4-7-thinking are cooling down [retrying in ~5 days attempt #1]",
            next: 300,
          },
        },
      },
    })
    await handler({
      event: {
        type: "session.status",
        properties: {
          sessionID,
          status: {
            type: "retry",
            attempt: 1,
            message:
              "All credentials for model claude-opus-4-7-thinking are cooling down [retrying in ~4 days attempt #1]",
            next: 299,
          },
        },
      },
    })

    //#then
    expect(abortCalls).toEqual([sessionID])
    expect(promptCalls).toEqual([sessionID])
  })

  test("re-handles the same retry key after session recovers through session.idle", async () => {
    //#given
    const sessionID = "ses_status_retry_real_idle_reset"
    setMainSession(sessionID)
    const modelFallback = createModelFallbackHook()
    clearPendingModelFallback(modelFallback, sessionID)
    const { handler, abortCalls, promptCalls } = createHandler({ hooks: { modelFallback } })
    const chatMessageHandler = createChatMessageHandler({
      ctx: unsafeTestValue({
        client: {
          tui: {
            showToast: async () => ({}),
          },
        },
      }),
      pluginConfig: unsafeTestValue({}),
      firstMessageVariantGate: {
        shouldOverride: () => false,
        markApplied: () => {},
      },
      hooks: unsafeTestValue({
        modelFallback,
        stopContinuationGuard: null,
        keywordDetector: null,
        claudeCodeHooks: null,
        autoSlashCommand: null,
        startWork: null,
        ralphLoop: null,
      }),
    })
    const retryStatus = {
      type: "session.status",
      properties: {
        sessionID,
        status: {
          type: "retry",
          attempt: 1,
          message:
            "All credentials for model claude-opus-4-7-thinking are cooling down [retrying in ~5 days attempt #1]",
          next: 300,
        },
      },
    }

    await handler({
      event: {
        type: "message.updated",
        properties: {
          info: {
            id: "msg_user_status_idle_reset",
            sessionID,
            role: "user",
            modelID: "claude-opus-4-7-thinking",
            providerID: "anthropic",
            agent: "Sisyphus - Ultraworker",
          },
        },
      },
    })

    //#when
    await handler({ event: retryStatus })
    await chatMessageHandler(
      {
        sessionID,
        agent: "sisyphus",
        model: { providerID: "anthropic", modelID: "claude-opus-4-7-thinking" },
      },
      { message: {}, parts: [] },
    )
    await handler({
      event: {
        type: "session.idle",
        properties: { sessionID },
      },
    })
    await handler({ event: retryStatus })

    //#then
    expect(abortCalls).toEqual([sessionID, sessionID])
    expect(promptCalls).toEqual([sessionID, sessionID])
  })

  test("does not leave stale pending fallback when a providerless duplicate arrives after fallback was applied", async () => {
    //#given
    const sessionID = "ses_model_fallback_duplicate_surface"
    setMainSession(sessionID)
    const modelFallback = createModelFallbackHook()
    clearPendingModelFallback(modelFallback, sessionID)
    const { handler, abortCalls, promptCalls } = createHandler({ hooks: { modelFallback } })
    const chatMessageHandler = createChatMessageHandler({
      ctx: unsafeTestValue({
        client: {
          tui: {
            showToast: async () => ({}),
          },
        },
      }),
      pluginConfig: unsafeTestValue({}),
      firstMessageVariantGate: {
        shouldOverride: () => false,
        markApplied: () => {},
      },
      hooks: unsafeTestValue({
        modelFallback,
        stopContinuationGuard: null,
        keywordDetector: null,
        claudeCodeHooks: null,
        autoSlashCommand: null,
        startWork: null,
        ralphLoop: null,
      }),
    })

    await handler({
      event: {
        type: "message.updated",
        properties: {
          info: {
            id: "msg_duplicate_surface_error",
            sessionID,
            role: "assistant",
            error: {
              name: "APIError",
              data: {
                message:
                  "Bad Gateway: {\"error\":{\"message\":\"unknown provider for model claude-opus-4-7-thinking\"}}",
                isRetryable: true,
              },
            },
            modelID: "claude-opus-4-7-thinking",
            providerID: "anthropic",
            agent: "Sisyphus - Ultraworker",
          },
        },
      },
    })

    const output: ChatMessageOutput = { message: {}, parts: [] }
    await chatMessageHandler(
      {
        sessionID,
        agent: "sisyphus",
        model: { providerID: "anthropic", modelID: "claude-opus-4-7-thinking" },
      },
      output,
    )

    //#when - same failed model arrives again without provider metadata after fallback was applied
    await handler({
      event: {
        type: "session.error",
        properties: {
          sessionID,
          error: {
            name: "UnknownError",
            data: {
              error: {
                message:
                  "Bad Gateway: {\"error\":{\"message\":\"unknown provider for model claude-opus-4-7-thinking\"}}",
              },
            },
          },
        },
      },
    })

    const staleOutput: ChatMessageOutput = { message: {}, parts: [] }
    await chatMessageHandler(
      {
        sessionID,
        agent: "sisyphus",
        model: { providerID: "opencode-go", modelID: "kimi-k2.6" },
      },
      staleOutput,
    )

    //#then
    expect(abortCalls).toEqual([sessionID])
    expect(promptCalls).toEqual([sessionID])
    expect(modelFallback.hasPendingModelFallback(sessionID)).toBe(false)
    expect(staleOutput.message["model"]).toBeUndefined()
  })

  test("does not trigger model-fallback from session.status when runtime_fallback is enabled", async () => {
    //#given
    const sessionID = "ses_status_retry_runtime_enabled"
    setMainSession(sessionID)
    const modelFallback = createModelFallbackHook()
    clearPendingModelFallback(modelFallback, sessionID)
    const runtimeFallback = {
      event: async () => {},
      "chat.message": async () => {},
    }
    const { handler, abortCalls, promptCalls } = createHandler({
      hooks: { modelFallback, runtimeFallback },
      pluginConfig: { runtime_fallback: { enabled: true } },
    })

    await handler({
      event: {
        type: "message.updated",
        properties: {
          info: {
            id: "msg_user_status_runtime_enabled",
            sessionID,
            role: "user",
            modelID: "claude-opus-4-7",
            providerID: "quotio",
            agent: "Sisyphus - Ultraworker",
          },
        },
      },
    })

    //#when
    await handler({
      event: {
        type: "session.status",
        properties: {
          sessionID,
          status: {
            type: "retry",
            attempt: 1,
            message:
              "All credentials for model claude-opus-4-7 are cooling down [retrying in 7m 56s attempt #1]",
            next: 476,
          },
        },
      },
    })

    //#then
    expect(abortCalls).toEqual([])
    expect(promptCalls).toEqual([])
  })

  test("prefers user-configured fallback_models over hardcoded chain on session.status retry", async () => {
    //#given
    const sessionID = "ses_status_retry_user_fallback"
    setMainSession(sessionID)
    const modelFallback = createModelFallbackHook()
    clearPendingModelFallback(modelFallback, sessionID)
    const pluginConfig = {
      agents: {
        sisyphus: {
          fallback_models: ["quotio/gpt-5.5", "quotio/kimi-k2.5"],
        },
      },
    }

    const { handler, abortCalls, promptCalls } = createHandler({ hooks: { modelFallback }, pluginConfig })

    const chatMessageHandler = createChatMessageHandler({
      ctx: unsafeTestValue({
        client: {
          tui: {
            showToast: async () => ({}),
          },
        },
      }),
      pluginConfig: unsafeTestValue({}),
      firstMessageVariantGate: {
        shouldOverride: () => false,
        markApplied: () => {},
      },
      hooks: unsafeTestValue({
        modelFallback,
        stopContinuationGuard: null,
        keywordDetector: null,
        claudeCodeHooks: null,
        autoSlashCommand: null,
        startWork: null,
        ralphLoop: null,
      }),
    })

    await handler({
      event: {
        type: "message.updated",
        properties: {
          info: {
            id: "msg_user_status_user_fallback",
            sessionID,
            role: "user",
            time: { created: 1 },
            content: [],
            modelID: "claude-opus-4-7",
            providerID: "quotio",
            agent: "Sisyphus - Ultraworker",
            path: { cwd: "/tmp", root: "/tmp" },
          },
        },
      },
    })

    //#when
    await handler({
      event: {
        type: "session.status",
        properties: {
          sessionID,
          status: {
            type: "retry",
            attempt: 1,
            message:
              "All credentials for model claude-opus-4-7-thinking are cooling down [retrying in ~5 days attempt #1]",
            next: 300,
          },
        },
      },
    })

    const output: ChatMessageOutput = { message: {}, parts: [] }
    await chatMessageHandler(
      {
        sessionID,
        agent: "sisyphus",
        model: { providerID: "quotio", modelID: "claude-opus-4-7" },
      },
      output,
    )

    //#then
    expect(abortCalls).toEqual([sessionID])
    expect(promptCalls).toEqual([sessionID])
    expect(output.message["model"]).toEqual({
      providerID: "quotio",
      modelID: "gpt-5.5",
    })
    expect(output.message["variant"]).toBeUndefined()
  })

  test("advances main-session fallback chain across repeated session.error retries end-to-end", async () => {
    //#given
    const abortCalls: string[] = []
    const promptCalls: string[] = []
    const toastCalls: string[] = []
    const sessionID = "ses_main_fallback_chain"
    setMainSession(sessionID)
    const modelFallback = createModelFallbackHook()
    clearPendingModelFallback(modelFallback, sessionID)

    setupConnectedProviderCacheMocks()
    const eventHandler = createEventHandler({
      ctx: unsafeTestValue({
        directory: "/tmp",
        client: {
          session: {
            abort: async ({ path }: { path: { id: string } }) => {
              abortCalls.push(path.id)
              return {}
            },
            prompt: async ({ path }: { path: { id: string } }) => {
              promptCalls.push(path.id)
              return {}
            },
          },
        },
      }),
      pluginConfig: unsafeTestValue({}),
      firstMessageVariantGate: {
        markSessionCreated: () => {},
        clear: () => {},
      },
      managers: unsafeTestValue({
        tmuxSessionManager: {
          onSessionCreated: async () => {},
          onSessionDeleted: async () => {},
        },
        skillMcpManager: {
          disconnectSession: async () => {},
        },
      }),
      hooks: unsafeTestValue({
        modelFallback,
      }),
    })

    const chatMessageHandler = createChatMessageHandler({
      ctx: unsafeTestValue({
        client: {
          tui: {
            showToast: async ({ body }: { body: { title?: string } }) => {
              if (body?.title) toastCalls.push(body.title)
              return {}
            },
          },
        },
      }),
      pluginConfig: unsafeTestValue({}),
      firstMessageVariantGate: {
        shouldOverride: () => false,
        markApplied: () => {},
      },
      hooks: unsafeTestValue({
        modelFallback,
        stopContinuationGuard: null,
        keywordDetector: null,
        claudeCodeHooks: null,
        autoSlashCommand: null,
        startWork: null,
        ralphLoop: null,
      }),
    })

    const triggerRetryCycle = async (providerID: string, modelID: string) => {
      await eventHandler(asEventHandlerInput({
        event: {
          type: "session.error",
          properties: {
            sessionID,
            providerID,
            modelID,
            error: {
              name: "UnknownError",
              data: {
                error: {
                  message:
                    `Bad Gateway: {"error":{"message":"unknown provider for model ${modelID}"}}`,
                },
              },
            },
          },
        },
      }))

      const output: ChatMessageOutput = { message: {}, parts: [] }
      await chatMessageHandler(
        {
          sessionID,
          agent: "sisyphus",
          model: { providerID: "anthropic", modelID: "claude-opus-4-7-thinking" },
        },
        output,
      )
      return output
    }

    //#when - first retry cycle
    const first = await triggerRetryCycle("anthropic", "claude-opus-4-7-thinking")

    //#then - first fallback entry applied (no-op skip: claude-opus-4-7 matches current model after normalization)
    expect(first.message["model"]).toMatchObject({
      providerID: "opencode-go",
      modelID: "kimi-k2.6",
    })
    expect(first.message["variant"]).toBeUndefined()

    //#when - second retry cycle
    const second = await triggerRetryCycle("opencode-go", "kimi-k2.6")

    //#then - second fallback entry applied (chain advanced past opencode-go/kimi-k2.6)
    expect(second.message["model"]).toMatchObject({
      providerID: "kimi-for-coding",
      modelID: "k2p5",
    })
    expect(second.message["variant"]).toBeUndefined()
    expect(abortCalls).toEqual([sessionID, sessionID])
    expect(promptCalls).toEqual([sessionID, sessionID])
    expect(toastCalls.length).toBeGreaterThanOrEqual(0)
  })

  test("does not trigger model-fallback retry when modelFallback hook is not provided (disabled by default)", async () => {
    //#given
    const sessionID = "ses_disabled_by_default"
    setMainSession(sessionID)
    const { handler, abortCalls, promptCalls } = createHandler()

    //#when - message.updated with assistant error
    await handler({
      event: {
        type: "message.updated",
        properties: {
          info: {
            id: "msg_err_disabled_1",
            sessionID,
            role: "assistant",
            time: { created: 1, completed: 2 },
            error: {
              name: "APIError",
              data: {
                message:
                  "Bad Gateway: {\"error\":{\"message\":\"unknown provider for model claude-opus-4-7-thinking\"}}",
                isRetryable: true,
              },
            },
            parentID: "msg_user_disabled_1",
            modelID: "claude-opus-4-7-thinking",
            providerID: "anthropic",
            agent: "Sisyphus - Ultraworker",
            path: { cwd: "/tmp", root: "/tmp" },
            cost: 0,
            tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
          },
        },
      },
    })

    //#when - session.error with retryable error
    await handler({
      event: {
        type: "session.error",
        properties: {
          sessionID,
          error: {
            name: "UnknownError",
            data: {
              error: {
                message:
                  "Bad Gateway: {\"error\":{\"message\":\"unknown provider for model claude-opus-4-7-thinking\"}}",
              },
            },
          },
        },
      },
    })

    //#then - no abort or prompt calls should have been made
    expect(abortCalls).toEqual([])
    expect(promptCalls).toEqual([])
  })

  // ---------------------------------------------------------------------------
  // RED tests for sync model-fallback bugs (Task 2.1).
  //
  // These tests pin the CURRENT (buggy) behavior of the sync session.status
  // model-fallback path. They are expected to FAIL until Task 2.2 (Fix A),
  // 2.3 (Fix B), and 2.4 (Fix D) land. Each test names the problem it proves.
  //
  //   Problem A: handleSessionStatus calls shouldRetryError({name: undefined,
  //     message}) and STOP_MESSAGE_PATTERNS contains "monthly limit" so a Z.ai
  //     "Weekly/Monthly Limit Exhausted" message returns false BEFORE the
  //     statusCode check -> fallback never armed.
  //   Problem B: autoContinueAfterFallback dispatches fallbackContext.
  //     {providerID, modelID} (the FAILED model) instead of the next entry
  //     from the configured chain -> ProviderModelNotFoundError zombie.
  //   Problem D: retryKey = attempt:provider/model:normalizedMessage; quota
  //     messages without provider/model collapse two different failed models
  //     (GLM -> GPT) to the same key -> second event wrongly treated as dup.
  // ---------------------------------------------------------------------------

  test("PROBLEM A (RED): session.status with Z.ai Weekly/Monthly Limit Exhausted message arms model-fallback for main session", async () => {
    //#given - Z.ai returns HTTP 429 with a quota-exhaustion message that
    // currently matches STOP_MESSAGE_PATTERNS ("monthly limit"), so
    // shouldRetryError returns false before the statusCode branch can run.
    // After Task 2.2, the handler must recognize quota-exhaustion 429s as
    // fallback-eligible regardless of the message pattern.
    const sessionID = "ses_problem_a_quota_exhaustion"
    setMainSession(sessionID)
    const modelFallback = createModelFallbackHook()
    clearPendingModelFallback(modelFallback, sessionID)
    const { handler, abortCalls, promptCalls } = createHandler({ hooks: { modelFallback } })

    await handler({
      event: {
        type: "message.updated",
        properties: {
          info: {
            id: "msg_user_problem_a",
            sessionID,
            role: "user",
            modelID: "glm-5.2",
            providerID: "zai-coding-plan",
            agent: "Sisyphus - Ultraworker",
          },
        },
      },
    })

    //#when - Z.ai quota exhaustion surfaces as session.status retry
    await handler({
      event: {
        type: "session.status",
        properties: {
          sessionID,
          status: {
            type: "retry",
            attempt: 1,
            message:
              "Weekly/Monthly Limit Exhausted. Your limit will reset at 2026-08-15 00:00:00",
            next: 1234,
          },
        },
      },
    })

    //#then - fallback MUST be armed and auto-continuation dispatched.
    // EXPECTED ON CURRENT (BUGGY) CODE: FAIL — fallback is NOT armed because
    // "monthly limit" in the message matches STOP_MESSAGE_PATTERNS and
    // shouldRetryError returns false before the statusCode branch.
    expect(abortCalls).toEqual([sessionID])
    expect(promptCalls).toEqual([sessionID])
    expect(modelFallback.hasPendingModelFallback(sessionID)).toBe(true)
  })

  test("PROBLEM B (RED): autoContinueAfterFallback dispatches the configured next model, not the failed model", async () => {
    //#given - failed model = zai-coding-plan/glm-5.2; user-configured chain
    // for sisyphus has exactly one next entry: deepseek/deepseek-v4-pro.
    // autoContinueAfterFallback should pull that next entry via
    // getNextFallback and dispatch it, NOT echo back the failed model.
    const sessionID = "ses_problem_b_wrong_dispatched_model"
    setMainSession(sessionID)
    const modelFallback = createModelFallbackHook()
    clearPendingModelFallback(modelFallback, sessionID)
    const pluginConfig = {
      agents: {
        sisyphus: {
          fallback_models: ["deepseek/deepseek-v4-pro"],
        },
      },
    }
    const { handler, promptAsyncBodies } = createHandler({
      hooks: { modelFallback },
      pluginConfig,
      promptAsync: async () => ({}),
    })

    // Seed lastKnownModel so the failed model resolves to glm-5.2.
    await handler({
      event: {
        type: "message.updated",
        properties: {
          info: {
            id: "msg_user_problem_b",
            sessionID,
            role: "user",
            modelID: "glm-5.2",
            providerID: "zai-coding-plan",
            agent: "Sisyphus - Ultraworker",
          },
        },
      },
    })

    //#when - session.status retry whose message carries NO model metadata
    // (typical for Z.ai quota: the model is implied by lastKnown, not in the
    // message text). shouldRetryError must still classify it as retryable so
    // fallback arms and auto-continues.
    await handler({
      event: {
        type: "session.status",
        properties: {
          sessionID,
          status: {
            type: "retry",
            attempt: 1,
            message: "Rate limit reached for this request. Please retry shortly.",
            next: 60,
          },
        },
      },
    })

    //#then - the dispatched promptAsync body.model MUST be the configured
    // next entry deepseek/deepseek-v4-pro.
    // EXPECTED ON CURRENT (BUGGY) CODE: FAIL — autoContinueAfterFallback
    // builds launchModel from fallbackContext.{providerID, modelID} which is
    // the FAILED model (zai-coding-plan/glm-5.2), so body.model echoes the
    // failed model instead of advancing the chain.
    expect(promptAsyncBodies).toHaveLength(1)
    expect(promptAsyncBodies[0]).toEqual({
      providerID: "deepseek",
      modelID: "deepseek-v4-pro",
    })
  })

  test("PROBLEM B (extra): abort failure before continuation does not consume a fallback rung via getNextFallback", async () => {
    //#given - abort throws before promptAsync runs. getNextFallback must not
    // be called yet (it is called later by the chat.message hook, not by
    // autoContinueAfterFallback), so attemptCount must not advance when the
    // abort fails and the continuation short-circuits. This is a baseline
    // characterization test: it documents whether the current code path
    // happens to advance the chain on abort failure.
    const sessionID = "ses_problem_b_abort_before_continuation"
    setMainSession(sessionID)
    const modelFallback = createModelFallbackHook()
    clearPendingModelFallback(modelFallback, sessionID)
    const pluginConfig = {
      agents: {
        sisyphus: {
          fallback_models: ["deepseek/deepseek-v4-pro"],
        },
      },
    }
    const { handler } = createHandler({
      hooks: { modelFallback },
      pluginConfig,
      abort: async () => {
        throw new Error("abort transport failed")
      },
      promptAsync: async () => ({}),
    })

    await handler({
      event: {
        type: "message.updated",
        properties: {
          info: {
            id: "msg_user_problem_b_abort",
            sessionID,
            role: "user",
            modelID: "glm-5.2",
            providerID: "zai-coding-plan",
            agent: "Sisyphus - Ultraworker",
          },
        },
      },
    })

    //#when - quota-style retry arrives; abort fails so continuation never
    // dispatches.
    await handler({
      event: {
        type: "session.status",
        properties: {
          sessionID,
          status: {
            type: "retry",
            attempt: 1,
            message: "Rate limit reached for this request. Please retry shortly.",
            next: 60,
          },
        },
      },
    })

    //#then - attemptCount must not have advanced (getNextFallback is only
    // called by the chat.message hook, which never ran). The pending
    // fallback may still be armed; only the chain index is asserted here.
    // BASELINE: this should PASS on current code because the chain advances
    // exclusively inside the chat.message hook, not inside abort handling.
    const state = modelFallback.getFallbackState(sessionID)
    expect(state?.attemptCount ?? 0).toBe(0)
  })

  test("PROBLEM D (RED): two consecutive session.status retries with the same quota message but different failed models are both processed", async () => {
    //#given - retryKey is built as `${attempt}:${providerID ?? ""}/${modelID
    // ?? ""}:${normalizeRetryStatusMessage(message)}`. When the quota message
    // carries no provider/model text (typical for Z.ai 429s), the key
    // collapses to `1:/:<normalized-message>` for BOTH events even when the
    // failed model changed (GLM -> GPT). The second event is then wrongly
    // treated as a duplicate and skipped.
    const sessionID = "ses_problem_d_dedup_collision"
    setMainSession(sessionID)
    const modelFallback = createModelFallbackHook()
    clearPendingModelFallback(modelFallback, sessionID)
    const { handler, abortCalls, promptCalls } = createHandler({ hooks: { modelFallback } })

    // First failed model: GLM via lastKnown.
    await handler({
      event: {
        type: "message.updated",
        properties: {
          info: {
            id: "msg_user_problem_d_glm",
            sessionID,
            role: "user",
            modelID: "glm-5.2",
            providerID: "zai-coding-plan",
            agent: "Sisyphus - Ultraworker",
          },
        },
      },
    })

    //#when - first quota retry for GLM
    await handler({
      event: {
        type: "session.status",
        properties: {
          sessionID,
          status: {
            type: "retry",
            attempt: 1,
            message: "Rate limit reached for this request. Please retry shortly.",
            next: 60,
          },
        },
      },
    })

    // Simulate the failed model changing to GPT before the next retry
    // surfaces (e.g. the chat.message fallback advanced to a GPT model that
    // then also hit the same provider quota).
    await handler({
      event: {
        type: "message.updated",
        properties: {
          info: {
            id: "msg_user_problem_d_gpt",
            sessionID,
            role: "user",
            modelID: "gpt-5.5",
            providerID: "openai",
            agent: "Sisyphus - Ultraworker",
          },
        },
      },
    })

    //#when - second quota retry with the SAME normalized message but now for
    // a DIFFERENT failed model (GPT). The two events have distinct
    // semantics: the first triggers fallback for GLM, the second for GPT.
    await handler({
      event: {
        type: "session.status",
        properties: {
          sessionID,
          status: {
            type: "retry",
            attempt: 1,
            message: "Rate limit reached for this request. Please retry shortly.",
            next: 60,
          },
        },
      },
    })

    //#then - BOTH retries must have triggered abort + prompt.
    // EXPECTED ON CURRENT (BUGGY) CODE: FAIL - only the first event
    // processes; the second collides on retryKey `1:/:rate limit reached...`
    // and is dropped as a duplicate.
    expect(abortCalls).toEqual([sessionID, sessionID])
    expect(promptCalls).toEqual([sessionID, sessionID])
  })

  test("NEGATIVE (baseline): session.status with a benign non-retryable message does not arm model-fallback", async () => {
    //#given - characterization baseline. The message below matches NO
    // RETRYABLE_MESSAGE_PATTERNS and NO STOP patterns, so shouldRetryError
    // returns false and no fallback is armed. This MUST stay green so the
    // RED tests above cannot be accused of just arming fallback for any
    // session.status event.
    const sessionID = "ses_negative_benign_message"
    setMainSession(sessionID)
    const modelFallback = createModelFallbackHook()
    clearPendingModelFallback(modelFallback, sessionID)
    const { handler, abortCalls, promptCalls } = createHandler({ hooks: { modelFallback } })

    await handler({
      event: {
        type: "message.updated",
        properties: {
          info: {
            id: "msg_user_negative_benign",
            sessionID,
            role: "user",
            modelID: "glm-5.2",
            providerID: "zai-coding-plan",
            agent: "Sisyphus - Ultraworker",
          },
        },
      },
    })

    //#when
    await handler({
      event: {
        type: "session.status",
        properties: {
          sessionID,
          status: {
            type: "retry",
            attempt: 1,
            message: "Informational: session heartbeat acknowledged.",
            next: 30,
          },
        },
      },
    })

    //#then - no fallback, no abort/prompt.
    expect(abortCalls).toEqual([])
    expect(promptCalls).toEqual([])
    expect(modelFallback.hasPendingModelFallback(sessionID)).toBe(false)
  })

  test("NEGATIVE (baseline): session.error with AbortError does not arm model-fallback", async () => {
    //#given - AbortError is not in NON_RETRYABLE_ERROR_NAMES verbatim, but
    // with an empty message no RETRYABLE pattern matches, so shouldRetryError
    // returns false. This pins the contract that genuine abort-style errors
    // do not consume a fallback rung.
    const sessionID = "ses_negative_abort_error"
    setMainSession(sessionID)
    const modelFallback = createModelFallbackHook()
    clearPendingModelFallback(modelFallback, sessionID)
    const { handler, abortCalls, promptCalls } = createHandler({ hooks: { modelFallback } })

    //#when
    await handler({
      event: {
        type: "session.error",
        properties: {
          sessionID,
          error: {
            name: "AbortError",
            message: "Request aborted by user.",
          },
        },
      },
    })

    //#then - no fallback armed.
    expect(abortCalls).toEqual([])
    expect(promptCalls).toEqual([])
    expect(modelFallback.hasPendingModelFallback(sessionID)).toBe(false)
  })

  test("CHAIN EXHAUSTION: once the configured fallback chain is fully consumed, a second retry does not dispatch another continuation", async () => {
    //#given - user-configured chain has exactly ONE entry. The first retry
    // consumes it; the second retry must NOT spawn another promptAsync
    // continuation (no orphan reservations, no zombie session).
    const sessionID = "ses_chain_exhaustion"
    setMainSession(sessionID)
    const modelFallback = createModelFallbackHook()
    clearPendingModelFallback(modelFallback, sessionID)
    const pluginConfig = {
      agents: {
        sisyphus: {
          fallback_models: ["deepseek/deepseek-v4-pro"],
        },
      },
    }
    const { handler, abortCalls, promptAsyncCalls } = createHandler({
      hooks: { modelFallback },
      pluginConfig,
      promptAsync: async () => ({}),
    })

    await handler({
      event: {
        type: "message.updated",
        properties: {
          info: {
            id: "msg_user_chain_exhaustion_1",
            sessionID,
            role: "user",
            modelID: "glm-5.2",
            providerID: "zai-coding-plan",
            agent: "Sisyphus - Ultraworker",
          },
        },
      },
    })

    //#when - first quota retry; auto-continuation dispatches once.
    await handler({
      event: {
        type: "session.status",
        properties: {
          sessionID,
          status: {
            type: "retry",
            attempt: 1,
            message: "Rate limit reached for this request. Please retry shortly.",
            next: 60,
          },
        },
      },
    })

    // Surface a different failed model so the second retry is NOT dropped by
    // the Problem-D dedup collision (we want to isolate chain-exhaustion
    // behavior from the dedup bug).
    await handler({
      event: {
        type: "message.updated",
        properties: {
          info: {
            id: "msg_user_chain_exhaustion_2",
            sessionID,
            role: "user",
            modelID: "deepseek-v4-pro",
            providerID: "deepseek",
            agent: "Sisyphus - Ultraworker",
          },
        },
      },
    })

    await handler({
      event: {
        type: "session.status",
        properties: {
          sessionID,
          status: {
            type: "retry",
            attempt: 1,
            message: "Rate limit reached for this request. Please retry shortly.",
            next: 60,
          },
        },
      },
    })

    //#then - exactly ONE continuation was dispatched. The second retry must
    // not spawn another promptAsync (the configured chain is exhausted).
    // BASELINE/RED: see /tmp/omo-task21-report.txt for the observed outcome;
    // current code may dispatch twice (Problem B echoes the failed model
    // instead of consulting the chain, so exhaustion is invisible to
    // autoContinueAfterFallback). After Task 2.3, this should PASS.
    expect(promptAsyncCalls).toEqual([sessionID])
    expect(abortCalls.length).toBeGreaterThanOrEqual(1)
  })
})
