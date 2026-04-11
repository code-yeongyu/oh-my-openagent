declare const require: (name: string) => any
const { afterEach, describe, expect, spyOn, test } = require("bun:test")

const PROVIDER_ID = "cliproxyapi"

import { createEventHandler } from "./event"
import { createChatMessageHandler } from "./chat-message"
import { createModelFallbackHook } from "../hooks/model-fallback/hook"
import { createRuntimeFallbackHook } from "../hooks/runtime-fallback"
import type { RuntimeFallbackPluginInput } from "../hooks/runtime-fallback/types"
import { _resetForTesting } from "../features/claude-code-session-state"
import { _resetForTesting as _resetModelFallbackForTesting } from "../hooks/model-fallback/hook"
import { SessionCategoryRegistry } from "../shared/session-category-registry"
import * as connectedProvidersCache from "../shared/connected-providers-cache"

type EventHandlerArgs = Parameters<typeof createEventHandler>[0]
type ChatMessageHandlerArgs = Parameters<typeof createChatMessageHandler>[0]
type HarnessContext = EventHandlerArgs["ctx"] & RuntimeFallbackPluginInput
type HarnessEventInput = Parameters<ReturnType<typeof createHarness>["eventHandler"]>[0]

function asHarnessEventInput(input: unknown): HarnessEventInput {
  return input as unknown as HarnessEventInput
}

function asHarnessContext(ctx: unknown): HarnessContext {
  return ctx as unknown as HarnessContext
}

function createEventHandlerManagers(
  overrides: Record<string, unknown> = {},
): EventHandlerArgs["managers"] {
  return {
    ...({} as EventHandlerArgs["managers"]),
    tmuxSessionManager: {
      onSessionCreated: async () => {},
      onSessionDeleted: async () => {},
    },
    ...overrides,
  } as unknown as EventHandlerArgs["managers"]
}

function createEventHandlerHooks(
  overrides: Record<string, unknown>,
): EventHandlerArgs["hooks"] {
  return {
    ...({} as EventHandlerArgs["hooks"]),
    ...overrides,
  } as unknown as EventHandlerArgs["hooks"]
}

function createChatMessageHandlerHooks(
  overrides: Record<string, unknown>,
): ChatMessageHandlerArgs["hooks"] {
  return {
    ...({} as ChatMessageHandlerArgs["hooks"]),
    ...overrides,
  } as unknown as ChatMessageHandlerArgs["hooks"]
}

const PRIMARY_MODEL = {
  providerID: PROVIDER_ID,
  modelID: "claude-opus-4-6",
}

const PRIMARY_MODEL_STRING = `${PRIMARY_MODEL.providerID}/${PRIMARY_MODEL.modelID}`

const FIRST_FALLBACK_MODEL = {
  providerID: PROVIDER_ID,
  modelID: "claude-sonnet-4-6",
}

const CLIPROXYAPI_FALLBACKS = [
  `${PROVIDER_ID}/claude-sonnet-4-6`,
  `${PROVIDER_ID}/gpt-5.4`,
  `${PROVIDER_ID}/kimi-k2.5`,
]

type HarnessMode = "none" | "model" | "runtime" | "both"

type PromptAsyncCall = {
  sessionID: string
  agent?: string
  model?: { providerID?: string; modelID?: string }
  parts?: Array<{ type?: string; text?: string }>
}

let readConnectedProvidersCacheSpy: { mockRestore: () => void } | undefined
let readProviderModelsCacheSpy: { mockRestore: () => void } | undefined

function createPluginConfig(mode: HarnessMode) {
  return {
    agents: {
      sisyphus: {
        fallback_models: CLIPROXYAPI_FALLBACKS,
      },
    },
    ...(mode === "runtime" || mode === "both"
      ? {
          runtime_fallback: {
            enabled: true,
          },
        }
      : {}),
  } as unknown as EventHandlerArgs["pluginConfig"]
}

function createHarness(args: {
  mode: HarnessMode
  promptAsyncImpl?: (call: PromptAsyncCall) => Promise<unknown>
  sessionTimeoutMs?: number
}) {
  setupConnectedProviderCacheMocks()
  const abortCalls: string[] = []
  const promptCalls: string[] = []
  const promptAsyncCalls: PromptAsyncCall[] = []
  const pluginConfig = createPluginConfig(args.mode)

  const ctx = asHarnessContext({
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
        messages: async () => ({
          data: [
            {
              info: { role: "user" },
              parts: [{ type: "text", text: "continue working on the same task" }],
            },
          ],
        }),
        ...(args.mode === "runtime" || args.mode === "both"
          ? {
              promptAsync: async (raw: unknown) => {
                const call = {
                  sessionID:
                    (raw as { path?: { id?: string } })?.path?.id ?? "unknown-session",
                  agent: (raw as { body?: { agent?: string } })?.body?.agent,
                  model: (raw as { body?: { model?: { providerID?: string; modelID?: string } } })?.body
                    ?.model,
                  parts: (raw as { body?: { parts?: Array<{ type?: string; text?: string }> } })?.body
                    ?.parts,
                }
                promptAsyncCalls.push(call)

                if (args.promptAsyncImpl) {
                  return args.promptAsyncImpl(call)
                }

                return {}
              },
            }
          : {}),
      },
      tui: {
        showToast: async () => ({}),
      },
    },
  })

  const hooks: Record<string, unknown> = {
    stopContinuationGuard: null,
    backgroundNotificationHook: null,
    keywordDetector: null,
    claudeCodeHooks: null,
    autoSlashCommand: null,
    startWork: null,
    ralphLoop: null,
  }

  if (args.mode === "model" || args.mode === "both") {
    hooks.modelFallback = createModelFallbackHook()
  }

  if (args.mode === "runtime" || args.mode === "both") {
    hooks.runtimeFallback = createRuntimeFallbackHook(ctx, {
      config: {
        enabled: true,
        retry_on_errors: [429, 503, 529],
        max_fallback_attempts: 6,
        cooldown_seconds: 15,
        timeout_seconds: args.sessionTimeoutMs ? 30 : 0,
        notify_on_fallback: false,
      },
      pluginConfig: pluginConfig as unknown as EventHandlerArgs["pluginConfig"],
      ...(args.sessionTimeoutMs ? { session_timeout_ms: args.sessionTimeoutMs } : {}),
    })
  }

  const eventHandler = createEventHandler({
    ctx,
    pluginConfig: pluginConfig as unknown as EventHandlerArgs["pluginConfig"],
    firstMessageVariantGate: {
      markSessionCreated: () => {},
      clear: () => {},
    },
    managers: createEventHandlerManagers({
      skillMcpManager: {
        disconnectSession: async () => {},
      },
    }),
    hooks: createEventHandlerHooks(hooks),
  })

  const chatMessageHandler = createChatMessageHandler({
    ctx,
    pluginConfig: pluginConfig as unknown as ChatMessageHandlerArgs["pluginConfig"],
    firstMessageVariantGate: {
      shouldOverride: () => false,
      markApplied: () => {},
    },
    hooks: createChatMessageHandlerHooks(hooks),
  })

  return {
    eventHandler,
    chatMessageHandler,
    abortCalls,
    promptCalls,
    promptAsyncCalls,
  }
}

async function primeMainSession(
  eventHandler: ReturnType<typeof createHarness>["eventHandler"],
  sessionID: string,
) {
  await eventHandler(asHarnessEventInput({
    event: {
      type: "session.created",
      properties: {
        info: {
          id: sessionID,
          model: PRIMARY_MODEL_STRING,
        },
      },
    },
  }))

  await eventHandler(asHarnessEventInput({
    event: {
      type: "message.updated",
      properties: {
        info: {
          id: `user-${sessionID}`,
          sessionID,
          role: "user",
          time: { created: 1 },
          content: [],
          modelID: PRIMARY_MODEL.modelID,
          providerID: PRIMARY_MODEL.providerID,
          agent: "Sisyphus - Ultraworker",
          path: { cwd: "/tmp", root: "/tmp" },
        },
      },
    },
  }))
}

async function sendNextMessage(
  chatMessageHandler: ReturnType<typeof createHarness>["chatMessageHandler"],
  input: { sessionID: string; agent?: string; model?: { providerID: string; modelID: string } },
) {
  const output = {
    message: {},
    parts: [] as Array<{ type: string; text?: string }>,
  }

  await chatMessageHandler(input, output)
  return output
}

async function triggerSessionError(
  eventHandler: ReturnType<typeof createHarness>["eventHandler"],
  sessionID: string,
) {
  await eventHandler(asHarnessEventInput({
    event: {
      type: "session.error",
      properties: {
        sessionID,
        agent: "sisyphus",
        providerID: PRIMARY_MODEL.providerID,
        modelID: PRIMARY_MODEL.modelID,
        model: PRIMARY_MODEL_STRING,
        error: {
          statusCode: 529,
          message: `Overloaded upstream for ${PRIMARY_MODEL_STRING}`,
        },
      },
    },
  }))
}

async function triggerSessionStatusRetry(
  eventHandler: ReturnType<typeof createHarness>["eventHandler"],
  sessionID: string,
) {
  await eventHandler(asHarnessEventInput({
    event: {
      type: "session.status",
      properties: {
        sessionID,
        agent: "sisyphus",
        model: PRIMARY_MODEL_STRING,
        status: {
          type: "retry",
          attempt: 1,
          message:
            "All credentials for model claude-opus-4-6 are cooling down [retrying in 7m 56s attempt #1]",
          next: 476,
        },
      },
    },
  }))
}

async function triggerAssistantMessageError(
  eventHandler: ReturnType<typeof createHarness>["eventHandler"],
  sessionID: string,
) {
  await eventHandler(asHarnessEventInput({
    event: {
      type: "message.updated",
      properties: {
        info: {
          id: `assistant-error-${sessionID}`,
          sessionID,
          role: "assistant",
          time: { created: 1, completed: 2 },
          model: PRIMARY_MODEL_STRING,
          modelID: PRIMARY_MODEL.modelID,
          providerID: PRIMARY_MODEL.providerID,
          agent: "Sisyphus - Ultraworker",
          path: { cwd: "/tmp", root: "/tmp" },
          error: {
            statusCode: 529,
            message: `Overloaded upstream for ${PRIMARY_MODEL_STRING}`,
          },
        },
      },
    },
  }))
}

afterEach(() => {
  readConnectedProvidersCacheSpy?.mockRestore()
  readProviderModelsCacheSpy?.mockRestore()
  readConnectedProvidersCacheSpy = undefined
  readProviderModelsCacheSpy = undefined
})

function setupConnectedProviderCacheMocks(): void {
  readConnectedProvidersCacheSpy = spyOn(connectedProvidersCache, "readConnectedProvidersCache").mockReturnValue([
    PROVIDER_ID,
  ])
  readProviderModelsCacheSpy = spyOn(connectedProvidersCache, "readProviderModelsCache").mockReturnValue({
    connected: [PROVIDER_ID],
    models: {},
    updatedAt: new Date(0).toISOString(),
  })
}

afterEach(() => {
  _resetForTesting()
  _resetModelFallbackForTesting()
  SessionCategoryRegistry.clear()
})

describe("CLIProxyAPI-only fallback matrix", () => {
  test("no fallback leaves retryable session.error on the primary CLIProxyAPI model", async () => {
    const sessionID = "cliproxyapi-none-session-error"
    const harness = createHarness({ mode: "none" })

    await primeMainSession(harness.eventHandler, sessionID)
    await triggerSessionError(harness.eventHandler, sessionID)

    const output = await sendNextMessage(harness.chatMessageHandler, {
      sessionID,
      agent: "sisyphus",
      model: PRIMARY_MODEL,
    })

    expect(harness.abortCalls).toEqual([])
    expect(harness.promptCalls).toEqual([])
    expect(harness.promptAsyncCalls).toEqual([])
    expect(output.message["model"]).toBeUndefined()
  })

  test("model fallback switches CLIProxyAPI session.error failures to the next CLIProxyAPI model", async () => {
    const sessionID = "cliproxyapi-model-session-error"
    const harness = createHarness({ mode: "model" })

    await primeMainSession(harness.eventHandler, sessionID)
    await triggerSessionError(harness.eventHandler, sessionID)

    const output = await sendNextMessage(harness.chatMessageHandler, {
      sessionID,
      agent: "sisyphus",
      model: PRIMARY_MODEL,
    })

    expect(harness.abortCalls).toEqual([sessionID])
    expect(harness.promptCalls).toEqual([sessionID])
    expect(harness.promptAsyncCalls).toEqual([])
    expect(output.message["model"]).toEqual(FIRST_FALLBACK_MODEL)
  })

  test("model fallback switches CLIProxyAPI session.status retry signals to the next CLIProxyAPI model", async () => {
    const sessionID = "cliproxyapi-model-session-status"
    const harness = createHarness({ mode: "model" })

    await primeMainSession(harness.eventHandler, sessionID)
    await triggerSessionStatusRetry(harness.eventHandler, sessionID)

    const output = await sendNextMessage(harness.chatMessageHandler, {
      sessionID,
      agent: "sisyphus",
      model: PRIMARY_MODEL,
    })

    expect(harness.abortCalls).toEqual([sessionID])
    expect(harness.promptCalls).toEqual([sessionID])
    expect(harness.promptAsyncCalls).toEqual([])
    expect(output.message["model"]).toEqual(FIRST_FALLBACK_MODEL)
  })

  test("model fallback switches CLIProxyAPI assistant message.updated errors to the next CLIProxyAPI model", async () => {
    const sessionID = "cliproxyapi-model-message-updated"
    const harness = createHarness({ mode: "model" })

    await primeMainSession(harness.eventHandler, sessionID)
    await triggerAssistantMessageError(harness.eventHandler, sessionID)

    const output = await sendNextMessage(harness.chatMessageHandler, {
      sessionID,
      agent: "sisyphus",
      model: PRIMARY_MODEL,
    })

    expect(harness.abortCalls).toEqual([sessionID])
    expect(harness.promptCalls).toEqual([sessionID])
    expect(harness.promptAsyncCalls).toEqual([])
    expect(output.message["model"]).toEqual(FIRST_FALLBACK_MODEL)
  })

  test("runtime fallback retries CLIProxyAPI session.error failures through promptAsync and overrides the next message model", async () => {
    const sessionID = "cliproxyapi-runtime-session-error"
    const harness = createHarness({ mode: "runtime" })

    await primeMainSession(harness.eventHandler, sessionID)
    await triggerSessionError(harness.eventHandler, sessionID)

    const output = await sendNextMessage(harness.chatMessageHandler, {
      sessionID,
      agent: "sisyphus",
    })

    expect(harness.abortCalls).toEqual([])
    expect(harness.promptCalls).toEqual([])
    expect(harness.promptAsyncCalls).toHaveLength(1)
    expect(harness.promptAsyncCalls[0]?.model).toEqual(FIRST_FALLBACK_MODEL)
    expect(output.message["model"]).toEqual(FIRST_FALLBACK_MODEL)
  })

  test("runtime fallback retries CLIProxyAPI session.status auto-retry signals through promptAsync", async () => {
    const sessionID = "cliproxyapi-runtime-session-status"
    const harness = createHarness({ mode: "runtime" })

    await primeMainSession(harness.eventHandler, sessionID)
    await triggerSessionStatusRetry(harness.eventHandler, sessionID)

    const output = await sendNextMessage(harness.chatMessageHandler, {
      sessionID,
      agent: "sisyphus",
    })

    expect(harness.abortCalls).toEqual([sessionID])
    expect(harness.promptCalls).toEqual([])
    expect(harness.promptAsyncCalls).toHaveLength(1)
    expect(harness.promptAsyncCalls[0]?.model).toEqual(FIRST_FALLBACK_MODEL)
    expect(output.message["model"]).toEqual(FIRST_FALLBACK_MODEL)
  })

  test("runtime fallback retries CLIProxyAPI assistant message.updated errors through promptAsync", async () => {
    const sessionID = "cliproxyapi-runtime-message-updated"
    const harness = createHarness({ mode: "runtime" })

    await primeMainSession(harness.eventHandler, sessionID)
    await triggerAssistantMessageError(harness.eventHandler, sessionID)

    const output = await sendNextMessage(harness.chatMessageHandler, {
      sessionID,
      agent: "sisyphus",
    })

    expect(harness.abortCalls).toEqual([])
    expect(harness.promptCalls).toEqual([])
    expect(harness.promptAsyncCalls).toHaveLength(1)
    expect(harness.promptAsyncCalls[0]?.model).toEqual(FIRST_FALLBACK_MODEL)
    expect(output.message["model"]).toEqual(FIRST_FALLBACK_MODEL)
  })

  test("model+runtime prefers the runtime path for CLIProxyAPI session.error failures", async () => {
    const sessionID = "cliproxyapi-both-session-error"
    const harness = createHarness({ mode: "both" })

    await primeMainSession(harness.eventHandler, sessionID)
    await triggerSessionError(harness.eventHandler, sessionID)

    const output = await sendNextMessage(harness.chatMessageHandler, {
      sessionID,
      agent: "sisyphus",
    })

    expect(harness.abortCalls).toEqual([])
    expect(harness.promptCalls).toEqual([])
    expect(harness.promptAsyncCalls).toHaveLength(1)
    expect(harness.promptAsyncCalls[0]?.model).toEqual(FIRST_FALLBACK_MODEL)
    expect(output.message["model"]).toEqual(FIRST_FALLBACK_MODEL)
  })

  test("model+runtime prefers the runtime path for CLIProxyAPI session.status retry signals", async () => {
    const sessionID = "cliproxyapi-both-session-status"
    const harness = createHarness({ mode: "both" })

    await primeMainSession(harness.eventHandler, sessionID)
    await triggerSessionStatusRetry(harness.eventHandler, sessionID)

    const output = await sendNextMessage(harness.chatMessageHandler, {
      sessionID,
      agent: "sisyphus",
    })

    expect(harness.abortCalls).toEqual([sessionID])
    expect(harness.promptCalls).toEqual([])
    expect(harness.promptAsyncCalls).toHaveLength(1)
    expect(harness.promptAsyncCalls[0]?.model).toEqual(FIRST_FALLBACK_MODEL)
    expect(output.message["model"]).toEqual(FIRST_FALLBACK_MODEL)
  })

  test("model+runtime prefers the runtime path for CLIProxyAPI assistant message.updated errors", async () => {
    const sessionID = "cliproxyapi-both-message-updated"
    const harness = createHarness({ mode: "both" })

    await primeMainSession(harness.eventHandler, sessionID)
    await triggerAssistantMessageError(harness.eventHandler, sessionID)

    const output = await sendNextMessage(harness.chatMessageHandler, {
      sessionID,
      agent: "sisyphus",
    })

    expect(harness.abortCalls).toEqual([])
    expect(harness.promptCalls).toEqual([])
    expect(harness.promptAsyncCalls).toHaveLength(1)
    expect(harness.promptAsyncCalls[0]?.model).toEqual(FIRST_FALLBACK_MODEL)
    expect(output.message["model"]).toEqual(FIRST_FALLBACK_MODEL)
  })
})
