declare const require: (name: string) => any
const { afterEach, describe, expect, mock, test } = require("bun:test")

mock.module("../shared/connected-providers-cache", () => ({
  readConnectedProvidersCache: () => ["quotio"],
  readProviderModelsCache: () => ({
    connected: ["quotio"],
  }),
}))

import { createEventHandler } from "./event"
import { createChatMessageHandler } from "./chat-message"
import { createModelFallbackHook } from "../hooks/model-fallback/hook"
import { createRuntimeFallbackHook } from "../hooks/runtime-fallback"
import { _resetForTesting } from "../features/claude-code-session-state"
import { SessionCategoryRegistry } from "../shared/session-category-registry"

const PRIMARY_MODEL = {
  providerID: "quotio",
  modelID: "claude-opus-4-6",
}

const PRIMARY_MODEL_STRING = `${PRIMARY_MODEL.providerID}/${PRIMARY_MODEL.modelID}`

const QUOTIO_FALLBACKS = [
  "quotio/claude-sonnet-4-6",
  "quotio/gpt-5.4",
  "quotio/kimi-k2.5",
]

type HarnessMode = "none" | "model" | "runtime" | "both"

type PromptAsyncCall = {
  sessionID: string
  agent?: string
  model?: { providerID?: string; modelID?: string }
  parts?: Array<{ type?: string; text?: string }>
}

function createPluginConfig(mode: HarnessMode) {
  return {
    agents: {
      sisyphus: {
        fallback_models: QUOTIO_FALLBACKS,
      },
    },
    ...(mode === "runtime" || mode === "both"
      ? {
          runtime_fallback: {
            enabled: true,
          },
        }
      : {}),
  }
}

function createHarness(args: {
  mode: HarnessMode
  promptAsyncImpl?: (call: PromptAsyncCall) => Promise<unknown>
  sessionTimeoutMs?: number
}) {
  const abortCalls: string[] = []
  const promptCalls: string[] = []
  const promptAsyncCalls: PromptAsyncCall[] = []
  const pluginConfig = createPluginConfig(args.mode)

  const ctx = {
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
  } as any

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
      pluginConfig,
      ...(args.sessionTimeoutMs ? { session_timeout_ms: args.sessionTimeoutMs } : {}),
    })
  }

  const eventHandler = createEventHandler({
    ctx,
    pluginConfig: pluginConfig as any,
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
    hooks: hooks as any,
  })

  const chatMessageHandler = createChatMessageHandler({
    ctx,
    pluginConfig: pluginConfig as any,
    firstMessageVariantGate: {
      shouldOverride: () => false,
      markApplied: () => {},
    },
    hooks: hooks as any,
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
  await eventHandler({
    event: {
      type: "session.created",
      properties: {
        info: {
          id: sessionID,
          model: PRIMARY_MODEL_STRING,
        },
      },
    },
  })

  await eventHandler({
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
          agent: "Sisyphus (Ultraworker)",
          path: { cwd: "/tmp", root: "/tmp" },
        },
      },
    },
  })
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
  await eventHandler({
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
          message: "Overloaded upstream for quotio/claude-opus-4-6",
        },
      },
    },
  })
}

async function triggerSessionStatusRetry(
  eventHandler: ReturnType<typeof createHarness>["eventHandler"],
  sessionID: string,
) {
  await eventHandler({
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
  })
}

async function triggerAssistantMessageError(
  eventHandler: ReturnType<typeof createHarness>["eventHandler"],
  sessionID: string,
) {
  await eventHandler({
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
          agent: "Sisyphus (Ultraworker)",
          path: { cwd: "/tmp", root: "/tmp" },
          error: {
            statusCode: 529,
            message: "Overloaded upstream for quotio/claude-opus-4-6",
          },
        },
      },
    },
  })
}

afterEach(() => {
  _resetForTesting()
  SessionCategoryRegistry.clear()
})

describe("Quotio-only fallback matrix", () => {
  test("no fallback leaves retryable session.error on the primary Quotio model", async () => {
    const sessionID = "quotio-none-session-error"
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

  test("model fallback switches Quotio session.error failures to the next Quotio model", async () => {
    const sessionID = "quotio-model-session-error"
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
    expect(output.message["model"]).toEqual({
      providerID: "quotio",
      modelID: "claude-sonnet-4-6",
    })
  })

  test("model fallback switches Quotio session.status retry signals to the next Quotio model", async () => {
    const sessionID = "quotio-model-session-status"
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
    expect(output.message["model"]).toEqual({
      providerID: "quotio",
      modelID: "claude-sonnet-4-6",
    })
  })

  test("model fallback switches Quotio assistant message.updated errors to the next Quotio model", async () => {
    const sessionID = "quotio-model-message-updated"
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
    expect(output.message["model"]).toEqual({
      providerID: "quotio",
      modelID: "claude-sonnet-4-6",
    })
  })

  test("runtime fallback retries Quotio session.error failures through promptAsync and overrides the next message model", async () => {
    const sessionID = "quotio-runtime-session-error"
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
    expect(harness.promptAsyncCalls[0]?.model).toEqual({
      providerID: "quotio",
      modelID: "claude-sonnet-4-6",
    })
    expect(output.message["model"]).toEqual({
      providerID: "quotio",
      modelID: "claude-sonnet-4-6",
    })
  })

  test("runtime fallback retries Quotio session.status auto-retry signals through promptAsync", async () => {
    const sessionID = "quotio-runtime-session-status"
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
    expect(harness.promptAsyncCalls[0]?.model).toEqual({
      providerID: "quotio",
      modelID: "claude-sonnet-4-6",
    })
    expect(output.message["model"]).toEqual({
      providerID: "quotio",
      modelID: "claude-sonnet-4-6",
    })
  })

  test("runtime fallback retries Quotio assistant message.updated errors through promptAsync", async () => {
    const sessionID = "quotio-runtime-message-updated"
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
    expect(harness.promptAsyncCalls[0]?.model).toEqual({
      providerID: "quotio",
      modelID: "claude-sonnet-4-6",
    })
    expect(output.message["model"]).toEqual({
      providerID: "quotio",
      modelID: "claude-sonnet-4-6",
    })
  })

  test("model+runtime prefers the runtime path for Quotio session.error failures", async () => {
    const sessionID = "quotio-both-session-error"
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
    expect(harness.promptAsyncCalls[0]?.model).toEqual({
      providerID: "quotio",
      modelID: "claude-sonnet-4-6",
    })
    expect(output.message["model"]).toEqual({
      providerID: "quotio",
      modelID: "claude-sonnet-4-6",
    })
  })

  test("model+runtime prefers the runtime path for Quotio session.status retry signals", async () => {
    const sessionID = "quotio-both-session-status"
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
    expect(harness.promptAsyncCalls[0]?.model).toEqual({
      providerID: "quotio",
      modelID: "claude-sonnet-4-6",
    })
    expect(output.message["model"]).toEqual({
      providerID: "quotio",
      modelID: "claude-sonnet-4-6",
    })
  })

  test("model+runtime prefers the runtime path for Quotio assistant message.updated errors", async () => {
    const sessionID = "quotio-both-message-updated"
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
    expect(harness.promptAsyncCalls[0]?.model).toEqual({
      providerID: "quotio",
      modelID: "claude-sonnet-4-6",
    })
    expect(output.message["model"]).toEqual({
      providerID: "quotio",
      modelID: "claude-sonnet-4-6",
    })
  })
})
