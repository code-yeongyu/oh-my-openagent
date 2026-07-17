import { afterEach, describe, expect, it } from "bun:test"
import { setMainSession } from "../../features/claude-code-session-state"
import { createAutoRetryHelpers } from "./auto-retry"
import { createRuntimeFallbackHook } from "./hook"
import type { HookDeps, RuntimeFallbackPluginInput } from "./types"

const SESSION_ID = "session-stale-status-continuation"

function createDeferred<T>(): {
  readonly promise: Promise<T>
  readonly resolve: (value: T) => void
} {
  let resolvePromise: ((value: T) => void) | undefined
  const promise = new Promise<T>((resolve) => {
    resolvePromise = resolve
  })
  return { promise, resolve: (value) => resolvePromise?.(value) }
}

function readPromptModel(input: unknown): string | undefined {
  if (typeof input !== "object" || input === null || !("body" in input)) return undefined
  const body = input.body
  if (typeof body !== "object" || body === null || !("model" in body)) return undefined
  const model = body.model
  if (typeof model !== "object" || model === null) return undefined
  const providerID = "providerID" in model ? model.providerID : undefined
  const modelID = "modelID" in model ? model.modelID : undefined
  return typeof providerID === "string" && typeof modelID === "string" ? `${providerID}/${modelID}` : undefined
}

function createContext(
  abort: () => Promise<unknown>,
  messages: () => Promise<unknown>,
  promptModels: string[],
): RuntimeFallbackPluginInput {
  return {
    client: {
      session: {
        abort,
        messages,
        promptAsync: async (input: unknown) => {
          const model = readPromptModel(input)
          if (model) promptModels.push(model)
          return {}
        },
      },
      tui: { showToast: async () => ({}) },
    },
    directory: "/test/dir",
  }
}

function retryEvent() {
  return {
    event: {
      type: "session.status",
      properties: {
        sessionID: SESSION_ID,
        agent: "sisyphus",
        model: "openai/primary",
        status: {
          type: "retry",
          attempt: 1,
          message: "Provider unavailable, retrying in 1s attempt #1",
        },
      },
    },
  }
}

function userEvent() {
  return {
    event: {
      type: "message.updated",
      properties: {
        info: {
          id: "user-message",
          role: "user",
          sessionID: SESSION_ID,
          agent: "sisyphus",
          model: "openai/primary",
        },
      },
    },
  }
}

const pluginConfig = {
  agents: {
    sisyphus: {
      model: "openai/primary",
      fallback_models: [{ model: "openai/fallback-one" }],
    },
  },
}

afterEach(() => setMainSession(undefined))

describe("runtime-fallback stale status continuation", () => {
  it("#given cleanup evicts a status retry during agent resolution #when resolution resumes #then it cannot abort or recreate state", async () => {
    const agentResolution = createDeferred<string | undefined>()
    const agentResolutionStarted = createDeferred<void>()
    const promptModels: string[] = []
    let abortCalls = 0
    let capturedDeps: HookDeps | undefined
    let cleanupStaleSessions: (() => void) | undefined
    const hook = createRuntimeFallbackHook(
      createContext(async () => { abortCalls += 1; return {} }, async () => ({ data: [] }), promptModels),
      { config: { enabled: true, timeout_seconds: 30, notify_on_fallback: false }, pluginConfig },
      {
        createAutoRetryHelpers: (deps) => {
          capturedDeps = deps
          const helpers = createAutoRetryHelpers(deps)
          cleanupStaleSessions = helpers.cleanupStaleSessions
          return {
            ...helpers,
            resolveAgentForSessionFromContext: async () => {
              agentResolutionStarted.resolve()
              return agentResolution.promise
            },
          }
        },
      },
    )
    setMainSession(SESSION_ID)

    try {
      await hook.event(userEvent())
      const pendingRetry = hook.event(retryEvent())
      await agentResolutionStarted.promise
      capturedDeps?.sessionLastAccess.set(SESSION_ID, Date.now() - 31 * 60 * 1000)
      cleanupStaleSessions?.()
      agentResolution.resolve("sisyphus")
      await pendingRetry

      expect({ abortCalls, promptModels, hasState: capturedDeps?.sessionStates.has(SESSION_ID) }).toEqual({
        abortCalls: 0,
        promptModels: [],
        hasState: false,
      })
    } finally {
      hook.dispose?.()
    }
  })

  it("#given cleanup evicts a status retry during message loading #when loading resumes #then it cannot dispatch or recreate state", async () => {
    const messagesResponse = createDeferred<unknown>()
    const messagesStarted = createDeferred<void>()
    const promptModels: string[] = []
    let abortCalls = 0
    let capturedDeps: HookDeps | undefined
    let cleanupStaleSessions: (() => void) | undefined
    const hook = createRuntimeFallbackHook(
      createContext(
        async () => { abortCalls += 1; return {} },
        async () => { messagesStarted.resolve(); return messagesResponse.promise },
        promptModels,
      ),
      { config: { enabled: true, timeout_seconds: 30, notify_on_fallback: false }, pluginConfig },
      {
        createAutoRetryHelpers: (deps) => {
          capturedDeps = deps
          const helpers = createAutoRetryHelpers(deps)
          cleanupStaleSessions = helpers.cleanupStaleSessions
          return helpers
        },
      },
    )
    setMainSession(SESSION_ID)

    try {
      await hook.event(userEvent())
      const pendingRetry = hook.event(retryEvent())
      await messagesStarted.promise
      capturedDeps?.sessionLastAccess.set(SESSION_ID, Date.now() - 31 * 60 * 1000)
      cleanupStaleSessions?.()
      messagesResponse.resolve({ data: [{ info: { role: "user" }, parts: [{ type: "text", text: "retry" }] }] })
      await pendingRetry

      expect({ abortCalls, promptModels, hasState: capturedDeps?.sessionStates.has(SESSION_ID) }).toEqual({
        abortCalls: 1,
        promptModels: [],
        hasState: false,
      })
    } finally {
      hook.dispose?.()
    }
  })
})
