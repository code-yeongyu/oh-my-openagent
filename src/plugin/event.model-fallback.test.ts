import { afterEach, describe, expect, test } from "bun:test"

import { createEventHandler } from "./event"
import { createChatMessageHandler } from "./chat-message"
import { _resetForTesting, setMainSession } from "../features/claude-code-session-state"
import { createModelFallbackHook, clearPendingModelFallback } from "../hooks/model-fallback/hook"

describe("createEventHandler - model fallback", () => {
  const createHandler = (args?: { hooks?: any; pluginConfig?: any }) => {
    const abortCalls: string[] = []
    const promptCalls: string[] = []

    const handler = createEventHandler({
      ctx: {
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
      } as any,
      pluginConfig: (args?.pluginConfig ?? {}) as any,
      firstMessageVariantGate: {
        markSessionCreated: () => {},
        clear: () => {},
      },
      managers: {
        tmuxSessionManager: {
          onSessionCreated: async () => {},
          onSessionDeleted: async () => {},
        },
        skillMcpManager: {
          disconnectSession: async () => {},
        },
      } as any,
      hooks: args?.hooks ?? ({} as any),
    })

    return { handler, abortCalls, promptCalls }
  }

  afterEach(() => {
    _resetForTesting()
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
                  "Bad Gateway: {\"error\":{\"message\":\"unknown provider for model claude-opus-4-6-thinking\"}}",
                isRetryable: true,
              },
            },
            parentID: "msg_user_1",
            modelID: "claude-opus-4-6-thinking",
            providerID: "anthropic",
            mode: "Sisyphus (Ultraworker)",
            agent: "Sisyphus (Ultraworker)",
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
                  "Bad Gateway: {\"error\":{\"message\":\"unknown provider for model claude-opus-4-6-thinking\"}}",
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

  test("triggers retry prompt on session.status retry events and applies fallback", async () => {
    //#given
    const sessionID = "ses_status_retry_fallback"
    setMainSession(sessionID)
    clearPendingModelFallback(sessionID)

    const modelFallback = createModelFallbackHook()

    const { handler, abortCalls, promptCalls } = createHandler({ hooks: { modelFallback } })

    const chatMessageHandler = createChatMessageHandler({
      ctx: {
        client: {
          tui: {
            showToast: async () => ({}),
          },
        },
      } as any,
      pluginConfig: {} as any,
      firstMessageVariantGate: {
        shouldOverride: () => false,
        markApplied: () => {},
      },
      hooks: {
        modelFallback,
        stopContinuationGuard: null,
        keywordDetector: null,
        claudeCodeHooks: null,
        autoSlashCommand: null,
        startWork: null,
        ralphLoop: null,
      } as any,
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
            modelID: "claude-opus-4-6-thinking",
            providerID: "anthropic",
            agent: "Sisyphus (Ultraworker)",
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
              "Bad Gateway: {\"error\":{\"message\":\"unknown provider for model claude-opus-4-6-thinking\"}}",
            next: 1234,
          },
        },
      },
    })

    const output = { message: {}, parts: [] as Array<{ type: string; text?: string }> }
    await chatMessageHandler(
      {
        sessionID,
        agent: "sisyphus",
        model: { providerID: "anthropic", modelID: "claude-opus-4-6-thinking" },
      },
      output,
    )

    //#then
    expect(abortCalls).toEqual([sessionID])
    expect(promptCalls).toEqual([sessionID])
    expect(output.message["model"]).toMatchObject({
      modelID: "claude-opus-4-6",
    })
    expect(["anthropic", "quotio"]).toContain((output.message["model"] as { providerID?: string })?.providerID)
    expect(output.message["variant"]).toBe("max")
  })

  test("does not spam abort/prompt when session.status retry countdown updates", async () => {
    //#given
    const sessionID = "ses_status_retry_dedup"
    setMainSession(sessionID)
    clearPendingModelFallback(sessionID)
    const modelFallback = createModelFallbackHook()
    const { handler, abortCalls, promptCalls } = createHandler({ hooks: { modelFallback } })

    await handler({
      event: {
        type: "message.updated",
        properties: {
          info: {
            id: "msg_user_status_dedup",
            sessionID,
            role: "user",
            modelID: "claude-opus-4-6-thinking",
            providerID: "anthropic",
            agent: "Sisyphus (Ultraworker)",
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
              "All credentials for model claude-opus-4-6-thinking are cooling down [retrying in ~5 days attempt #1]",
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
              "All credentials for model claude-opus-4-6-thinking are cooling down [retrying in ~4 days attempt #1]",
            next: 299,
          },
        },
      },
    })

    //#then
    expect(abortCalls).toEqual([sessionID])
    expect(promptCalls).toEqual([sessionID])
  })

  test("does not trigger model-fallback from session.status when runtime_fallback is enabled", async () => {
    //#given
    const sessionID = "ses_status_retry_runtime_enabled"
    setMainSession(sessionID)
    clearPendingModelFallback(sessionID)
    const modelFallback = createModelFallbackHook()
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
            modelID: "claude-opus-4-6",
            providerID: "quotio",
            agent: "Sisyphus (Ultraworker)",
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
              "All credentials for model claude-opus-4-6 are cooling down [retrying in 7m 56s attempt #1]",
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
    clearPendingModelFallback(sessionID)

    const modelFallback = createModelFallbackHook()
    const pluginConfig = {
      agents: {
        sisyphus: {
          fallback_models: ["quotio/gpt-5.2", "quotio/kimi-k2.5"],
        },
      },
    }

    const { handler, abortCalls, promptCalls } = createHandler({ hooks: { modelFallback }, pluginConfig })

    const chatMessageHandler = createChatMessageHandler({
      ctx: {
        client: {
          tui: {
            showToast: async () => ({}),
          },
        },
      } as any,
      pluginConfig: {} as any,
      firstMessageVariantGate: {
        shouldOverride: () => false,
        markApplied: () => {},
      },
      hooks: {
        modelFallback,
        stopContinuationGuard: null,
        keywordDetector: null,
        claudeCodeHooks: null,
        autoSlashCommand: null,
        startWork: null,
        ralphLoop: null,
      } as any,
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
            modelID: "claude-opus-4-6",
            providerID: "quotio",
            agent: "Sisyphus (Ultraworker)",
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
              "All credentials for model claude-opus-4-6-thinking are cooling down [retrying in ~5 days attempt #1]",
            next: 300,
          },
        },
      },
    })

    const output = { message: {}, parts: [] as Array<{ type: string; text?: string }> }
    await chatMessageHandler(
      {
        sessionID,
        agent: "sisyphus",
        model: { providerID: "quotio", modelID: "claude-opus-4-6" },
      },
      output,
    )

    //#then
    expect(abortCalls).toEqual([sessionID])
    expect(promptCalls).toEqual([sessionID])
    expect(output.message["model"]).toEqual({
      providerID: "quotio",
      modelID: "gpt-5.2",
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
    clearPendingModelFallback(sessionID)

    const modelFallback = createModelFallbackHook()

    const eventHandler = createEventHandler({
      ctx: {
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
      } as any,
      pluginConfig: {} as any,
      firstMessageVariantGate: {
        markSessionCreated: () => {},
        clear: () => {},
      },
      managers: {
        tmuxSessionManager: {
          onSessionCreated: async () => {},
          onSessionDeleted: async () => {},
        },
        skillMcpManager: {
          disconnectSession: async () => {},
        },
      } as any,
      hooks: {
        modelFallback,
      } as any,
    })

    const chatMessageHandler = createChatMessageHandler({
      ctx: {
        client: {
          tui: {
            showToast: async ({ body }: { body: { title?: string } }) => {
              if (body?.title) toastCalls.push(body.title)
              return {}
            },
          },
        },
      } as any,
      pluginConfig: {} as any,
      firstMessageVariantGate: {
        shouldOverride: () => false,
        markApplied: () => {},
      },
      hooks: {
        modelFallback,
        stopContinuationGuard: null,
        keywordDetector: null,
        claudeCodeHooks: null,
        autoSlashCommand: null,
        startWork: null,
        ralphLoop: null,
      } as any,
    })

    const triggerRetryCycle = async () => {
      await eventHandler({
        event: {
          type: "session.error",
          properties: {
            sessionID,
            providerID: "anthropic",
            modelID: "claude-opus-4-6-thinking",
            error: {
              name: "UnknownError",
              data: {
                error: {
                  message:
                    "Bad Gateway: {\"error\":{\"message\":\"unknown provider for model claude-opus-4-6-thinking\"}}",
                },
              },
            },
          },
        },
      })

      const output = { message: {}, parts: [] as Array<{ type: string; text?: string }> }
      await chatMessageHandler(
        {
          sessionID,
          agent: "sisyphus",
          model: { providerID: "anthropic", modelID: "claude-opus-4-6-thinking" },
        },
        output,
      )
      return output
    }

    //#when - first retry cycle
    const first = await triggerRetryCycle()

    //#then - first fallback entry applied (prefers current provider when available)
    expect(first.message["model"]).toMatchObject({
      modelID: "claude-opus-4-6",
    })
    expect(["anthropic", "quotio"]).toContain((first.message["model"] as { providerID?: string })?.providerID)
    expect(first.message["variant"]).toBe("max")

    //#when - second retry cycle
    const second = await triggerRetryCycle()

    //#then - second fallback entry applied (chain advanced)
    expect(second.message["model"]).toEqual({
      providerID: "kimi-for-coding",
      modelID: "k2p5",
    })
    expect((second.message["model"] as { providerID?: string })?.providerID).toBeTruthy()
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
                  "Bad Gateway: {\"error\":{\"message\":\"unknown provider for model claude-opus-4-6-thinking\"}}",
                isRetryable: true,
              },
            },
            parentID: "msg_user_disabled_1",
            modelID: "claude-opus-4-6-thinking",
            providerID: "anthropic",
            agent: "Sisyphus (Ultraworker)",
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
                  "Bad Gateway: {\"error\":{\"message\":\"unknown provider for model claude-opus-4-6-thinking\"}}",
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
