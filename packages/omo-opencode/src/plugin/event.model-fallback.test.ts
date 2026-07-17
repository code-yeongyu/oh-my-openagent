/// <reference types="bun-types" />
import { afterEach, describe, expect, spyOn, test } from "bun:test"
import { unsafeTestValue } from "../../../../test-support/unsafe-test-value"
import { _resetForTesting, setMainSession } from "../features/claude-code-session-state"
import { clearPendingModelFallback, createModelFallbackHook } from "../hooks/model-fallback/hook"
import {
  releaseAllPromptAsyncReservationsForTesting,
  releasePromptAsyncReservation,
} from "../hooks/shared/prompt-async-gate"
import * as connectedProvidersCache from "../shared/connected-providers-cache"
import { createChatMessageHandler } from "./chat-message"
import { createEventHandler } from "./event"

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
    abort?: (input: { path: { id: string }; throwOnError?: boolean }) => Promise<unknown>
    promptAsync?: (input: { path: { id: string } }) => Promise<unknown>
  }) => {
    setupConnectedProviderCacheMocks()
    const abortCalls: string[] = []
    const promptCalls: string[] = []
    const promptAsyncCalls: string[] = []

    const sessionClient = {
      abort: async (input: { path: { id: string }; throwOnError?: boolean }) => {
        const { path } = input
        abortCalls.push(path.id)
        if (args?.abort) {
          return args.abort(input)
        }
        return {}
      },
      prompt: async ({ path }: { path: { id: string } }) => {
        promptCalls.push(path.id)
        return {}
      },
      ...(args?.promptAsync
        ? {
            promptAsync: async (input: { path: { id: string } }) => {
              promptAsyncCalls.push(input.path.id)
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

    return { handler, abortCalls, promptCalls, promptAsyncCalls }
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

  test("#given the SDK resolves a non-2xx abort #when model-fallback handles an assistant error #then it requests throwing semantics and does not inject another prompt", async () => {
    const sessionID = "ses_model_fallback_abort_resolved_error"
    setMainSession(sessionID)
    let abortCalledWithThrowOnError = false
    const modelFallback = unsafeTestValue({
      setSessionFallbackChain: () => {},
      setPendingModelFallback: () => true,
    })
    const { handler, abortCalls, promptAsyncCalls } = createHandler({
      hooks: { modelFallback },
      abort: async (input) => {
        abortCalledWithThrowOnError = input.throwOnError === true
        return {
          data: undefined,
          error: { name: "NotFoundError" },
          response: new Response(null, { status: 404 }),
        }
      },
      promptAsync: async () => ({}),
    })
    const assistantError = {
      name: "APIError",
      data: {
        message: "Bad Gateway: {\"error\":{\"message\":\"unknown provider for model claude-opus-4-7-thinking\"}}",
        isRetryable: true,
      },
    }

    await handler({
      event: {
        type: "message.updated",
        properties: {
          info: {
            id: "msg_err_abort_resolved_error",
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

    expect(abortCalls).toEqual([sessionID])
    expect(abortCalledWithThrowOnError).toBe(true)
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
})
