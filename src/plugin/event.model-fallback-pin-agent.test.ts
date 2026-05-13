declare const require: (name: string) => any
const { afterEach, describe, expect, spyOn, test } = require("bun:test")

import { createEventHandler } from "./event"
import { _resetForTesting, setMainSession } from "../features/claude-code-session-state"
import { createModelFallbackHook, clearPendingModelFallback } from "../hooks/model-fallback/hook"
import * as connectedProvidersCache from "../shared/connected-providers-cache"

let readConnectedProvidersCacheSpy: { mockRestore: () => void } | undefined
let readProviderModelsCacheSpy: { mockRestore: () => void } | undefined

function setupConnectedProviderCacheMocks(): void {
  readConnectedProvidersCacheSpy = spyOn(connectedProvidersCache, "readConnectedProvidersCache").mockReturnValue(null)
  readProviderModelsCacheSpy = spyOn(connectedProvidersCache, "readProviderModelsCache").mockReturnValue(null)
}

type PromptBody = {
  path: { id: string }
  body: {
    parts: Array<{ type: "text"; text: string }>
    agent?: string
    model?: { providerID: string; modelID: string }
    variant?: string
  }
  query: { directory: string }
}

describe("createEventHandler - model-fallback auto-continuation pins agent/model/variant", () => {
  const createHandler = (args?: {
    hooks?: any
    pluginConfig?: any
    withPromptAsync?: boolean
  }) => {
    setupConnectedProviderCacheMocks()
    const promptAsyncBodies: PromptBody[] = []
    const promptBodies: PromptBody[] = []

    const sessionClient: Record<string, any> = {
      abort: async () => ({}),
      prompt: async (input: PromptBody) => {
        promptBodies.push(input)
        return {}
      },
    }
    if (args?.withPromptAsync ?? true) {
      sessionClient.promptAsync = async (input: PromptBody) => {
        promptAsyncBodies.push(input)
        return {}
      }
    }

    const handler = createEventHandler({
      ctx: {
        directory: "/tmp",
        client: { session: sessionClient },
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

    return { handler, promptAsyncBodies, promptBodies }
  }

  afterEach(() => {
    readConnectedProvidersCacheSpy?.mockRestore()
    readProviderModelsCacheSpy?.mockRestore()
    readConnectedProvidersCacheSpy = undefined
    readProviderModelsCacheSpy = undefined
    _resetForTesting()
  })

  test("pins agent/model on promptAsync body when continuing after message.updated fallback", async () => {
    // given
    const sessionID = "ses_pin_message_updated"
    setMainSession(sessionID)
    const modelFallback = createModelFallbackHook()
    clearPendingModelFallback(modelFallback, sessionID)
    const { handler, promptAsyncBodies } = createHandler({ hooks: { modelFallback } })

    // when
    await handler({
      event: {
        type: "message.updated",
        properties: {
          info: {
            id: "msg_err_pin_1",
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
            parentID: "msg_user_pin_1",
            modelID: "claude-opus-4-7-thinking",
            providerID: "anthropic",
            agent: "Sisyphus - Ultraworker",
          },
        },
      },
    })

    // then
    expect(promptAsyncBodies.length).toBe(1)
    const body = promptAsyncBodies[0]!.body
    expect(body.agent).toBeDefined()
    expect(body.agent).toContain("Sisyphus")
    expect(body.model).toEqual({
      providerID: "anthropic",
      modelID: "claude-opus-4-7",
    })
  })

  test("pins agent/model on promptAsync body when continuing after session.error fallback", async () => {
    // given
    const sessionID = "ses_pin_session_error"
    setMainSession(sessionID)
    const modelFallback = createModelFallbackHook()
    clearPendingModelFallback(modelFallback, sessionID)
    const { handler, promptAsyncBodies } = createHandler({ hooks: { modelFallback } })

    // when
    await handler({
      event: {
        type: "session.error",
        properties: {
          sessionID,
          providerID: "anthropic",
          modelID: "claude-opus-4-7-thinking",
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

    // then
    expect(promptAsyncBodies.length).toBe(1)
    const body = promptAsyncBodies[0]!.body
    expect(body.agent).toBeDefined()
    expect(body.agent?.toLowerCase()).toContain("sisyphus")
    expect(body.model).toEqual({
      providerID: "anthropic",
      modelID: "claude-opus-4-7",
    })
  })

  test("pins agent/model on fallback prompt() body when promptAsync is not available (session.status)", async () => {
    // given
    const sessionID = "ses_pin_session_status_noasync"
    setMainSession(sessionID)
    const modelFallback = createModelFallbackHook()
    clearPendingModelFallback(modelFallback, sessionID)
    const { handler, promptBodies, promptAsyncBodies } = createHandler({
      hooks: { modelFallback },
      withPromptAsync: false,
    })

    await handler({
      event: {
        type: "message.updated",
        properties: {
          info: {
            id: "msg_user_status_noasync",
            sessionID,
            role: "user",
            modelID: "claude-opus-4-7-thinking",
            providerID: "anthropic",
            agent: "Sisyphus - Ultraworker",
          },
        },
      },
    })

    // when
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

    // then
    expect(promptAsyncBodies.length).toBe(0)
    expect(promptBodies.length).toBe(1)
    const body = promptBodies[0]!.body
    expect(body.agent).toBeDefined()
    expect(body.agent).toContain("Sisyphus")
    expect(body.model).toEqual({
      providerID: "anthropic",
      modelID: "claude-opus-4-7",
    })
  })

  test("pins variant from agent config when present", async () => {
    // given
    const sessionID = "ses_pin_variant"
    setMainSession(sessionID)
    const modelFallback = createModelFallbackHook()
    clearPendingModelFallback(modelFallback, sessionID)
    const pluginConfig = {
      agents: {
        sisyphus: {
          variant: "thinking",
        },
      },
    }
    const { handler, promptAsyncBodies } = createHandler({
      hooks: { modelFallback },
      pluginConfig,
    })

    // when
    await handler({
      event: {
        type: "session.error",
        properties: {
          sessionID,
          providerID: "anthropic",
          modelID: "claude-opus-4-7-thinking",
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

    // then
    expect(promptAsyncBodies.length).toBe(1)
    const body = promptAsyncBodies[0]!.body
    expect(body.variant).toBe("thinking")
  })
})
