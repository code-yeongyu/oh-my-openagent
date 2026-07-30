import { describe, expect, it } from "bun:test"
import type { AutoRetryHelpers } from "./auto-retry"
import { createAbortSessionRequest } from "./auto-retry-abort"
import { createEventHandler } from "./event-handler"
import { createMessageUpdateHandler } from "./message-update-handler"
import type { HookDeps, RuntimeFallbackPluginInput } from "./types"

function deferred<T>() {
  let resolvePromise: ((value: T) => void) | undefined
  const promise = new Promise<T>((resolve) => { resolvePromise = resolve })
  return { promise, resolve: (value: T) => resolvePromise?.(value) }
}

function createDeps(abort: () => Promise<unknown> = async () => ({})): HookDeps {
  const ctx: RuntimeFallbackPluginInput = {
    client: {
      session: { abort, messages: async () => ({ data: [] }), promptAsync: async () => ({}) },
      tui: { showToast: async () => ({}) },
    },
    directory: "/tmp",
  }
  return {
    ctx,
    config: {
      enabled: true,
      retry_on_errors: [429, 503, 529],
      max_fallback_attempts: 3,
      cooldown_seconds: 60,
      timeout_seconds: 30,
      notify_on_fallback: false,
      restore_primary_after_cooldown: false,
    },
    options: undefined,
    pluginConfig: { agents: { sisyphus: { model: "openai/primary", fallback_models: [{ model: "openai/fallback" }] } } },
    sessionStates: new Map(),
    sessionLastAccess: new Map(),
    sessionRetryInFlight: new Set(),
    sessionAwaitingFallbackResult: new Set(),
    sessionFallbackTimeouts: new Map(),
    sessionStatusRetryKeys: new Map(),
    internallyAbortedSessions: new Set(),
  }
}

function userEvent(sessionID: string, id: string) {
  return { event: { type: "message.updated", properties: { info: { id, role: "user", sessionID } } } }
}

function retryEvent(sessionID: string) {
  return {
    event: {
      type: "session.status",
      properties: {
        sessionID,
        agent: "sisyphus",
        model: "openai/primary",
        status: { type: "retry", attempt: 1, message: "Provider unavailable, retrying in 1s attempt #1" },
      },
    },
  }
}

describe("runtime-fallback event generation ownership", () => {
  it("#given an old status handler is resolving its agent #when an identical retry arrives in a newer user turn #then the newer retry is not poisoned by stale dedupe", async () => {
    const resolution = deferred<string | undefined>()
    const resolutionStarted = deferred<void>()
    const deps = createDeps()
    const retries: string[] = []
    const helpers: AutoRetryHelpers = {
      abortSessionRequest: async () => true,
      clearSessionFallbackTimeout: () => {},
      scheduleSessionFallbackTimeout: () => {},
      autoRetryWithFallback: async (_id, model) => { retries.push(model); return { accepted: true, status: "dispatched" } },
      resolveAgentForSessionFromContext: async () => { resolutionStarted.resolve(); return resolution.promise },
      cleanupStaleSessions: () => {},
    }
    const handler = createEventHandler(deps, helpers)
    const sessionID = "session-status-key-generation"

    await handler(userEvent(sessionID, "user-1"))
    const staleRetry = handler(retryEvent(sessionID))
    await resolutionStarted.promise
    await handler(userEvent(sessionID, "user-2"))
    resolution.resolve("sisyphus")
    await staleRetry
    helpers.resolveAgentForSessionFromContext = async () => "sisyphus"
    await handler(retryEvent(sessionID))

    expect(retries).toEqual(["openai/fallback"])
  })

  it("#given session.error is resolving an agent #when a newer user turn arrives #then the stale error cannot dispatch fallback", async () => {
    const resolution = deferred<string | undefined>()
    const resolutionStarted = deferred<void>()
    const deps = createDeps()
    const retries: string[] = []
    const helpers: AutoRetryHelpers = {
      abortSessionRequest: async () => true,
      clearSessionFallbackTimeout: () => {},
      scheduleSessionFallbackTimeout: () => {},
      autoRetryWithFallback: async (_id, model) => { retries.push(model); return { accepted: true, status: "dispatched" } },
      resolveAgentForSessionFromContext: async () => { resolutionStarted.resolve(); return resolution.promise },
      cleanupStaleSessions: () => {},
    }
    const handler = createEventHandler(deps, helpers)
    const sessionID = "session-error-generation"

    await handler(userEvent(sessionID, "user-1"))
    const staleError = handler({ event: { type: "session.error", properties: { sessionID, agent: "sisyphus", error: { statusCode: 503 } } } })
    await resolutionStarted.promise
    await handler(userEvent(sessionID, "user-2"))
    resolution.resolve("sisyphus")
    await staleError

    expect(retries).toEqual([])
    expect(deps.sessionStates.has(sessionID)).toBe(false)
  })

  it("#given fallback completion visibility is pending #when the same user message is updated again #then the completion keeps generation ownership", async () => {
    const messages = deferred<unknown>()
    const messagesStarted = deferred<void>()
    const deps = createDeps()
    deps.ctx.client.session.messages = async () => {
      messagesStarted.resolve()
      return messages.promise
    }
    const helpers: AutoRetryHelpers = {
      abortSessionRequest: async () => true,
      clearSessionFallbackTimeout: () => {},
      scheduleSessionFallbackTimeout: () => {},
      autoRetryWithFallback: async () => ({ accepted: true, status: "dispatched" }),
      resolveAgentForSessionFromContext: async () => "sisyphus",
      cleanupStaleSessions: () => {},
    }
    const lifecycle = createEventHandler(deps, helpers)
    const messageHandler = createMessageUpdateHandler(deps, helpers)
    const sessionID = "session-duplicate-user-update"

    await lifecycle(userEvent(sessionID, "user-1"))
    deps.sessionAwaitingFallbackResult.add(sessionID)
    const completion = messageHandler({
      info: { id: "assistant-1", role: "assistant", sessionID, model: "openai/fallback" },
    })
    await messagesStarted.promise
    await lifecycle(userEvent(sessionID, "user-1"))
    messages.resolve({
      data: [
        { info: { id: "user-1", role: "user" }, parts: [{ type: "text", text: "retry" }] },
        { info: { id: "assistant-1", role: "assistant" }, parts: [{ type: "text", text: "done" }] },
      ],
    })
    await completion

    expect(deps.sessionAwaitingFallbackResult.has(sessionID)).toBe(false)
  })

  it("#given an abort is pending for a deleted session #when the same ID is reused #then replacement abort issues a fresh wire request", async () => {
    const oldAbort = deferred<unknown>()
    let abortCalls = 0
    const deps = createDeps(async () => {
      abortCalls += 1
      return abortCalls === 1 ? oldAbort.promise : {}
    })
    const abortSessionRequest = createAbortSessionRequest(deps)
    const helpers = {
      abortSessionRequest,
      clearSessionFallbackTimeout: () => {},
      scheduleSessionFallbackTimeout: () => {},
      autoRetryWithFallback: async () => ({ accepted: true, status: "dispatched" } as const),
      resolveAgentForSessionFromContext: async () => undefined,
      cleanupStaleSessions: () => {},
    }
    const handler = createEventHandler(deps, helpers)
    const sessionID = "session-abort-reuse"

    const oldRequest = abortSessionRequest(sessionID, "session.status.retry-signal")
    await Promise.resolve()
    await handler({ event: { type: "session.deleted", properties: { sessionID } } })
    const replacementRequest = abortSessionRequest(sessionID, "session.status.retry-signal")
    await Promise.resolve()
    oldAbort.resolve({})

    expect(await Promise.all([oldRequest, replacementRequest])).toEqual([false, true])
    expect(abortCalls).toBe(2)
  })

  it("#given an assistant quota error is awaiting abort #when a newer user turn arrives #then the stale message cannot dispatch fallback", async () => {
    const abort = deferred<boolean>()
    const abortStarted = deferred<void>()
    const deps = createDeps()
    const retries: string[] = []
    const helpers: AutoRetryHelpers = {
      abortSessionRequest: async () => { abortStarted.resolve(); return abort.promise },
      clearSessionFallbackTimeout: () => {},
      scheduleSessionFallbackTimeout: () => {},
      autoRetryWithFallback: async (_id, model) => { retries.push(model); return { accepted: true, status: "dispatched" } },
      resolveAgentForSessionFromContext: async () => "sisyphus",
      cleanupStaleSessions: () => {},
    }
    const lifecycle = createEventHandler(deps, helpers)
    const messages = createMessageUpdateHandler(deps, helpers)
    const sessionID = "session-message-abort-generation"

    await lifecycle(userEvent(sessionID, "user-1"))
    const staleMessage = messages({
      info: {
        id: "assistant-error",
        role: "assistant",
        sessionID,
        agent: "sisyphus",
        model: "openai/primary",
        error: { name: "QuotaExceeded", message: "quota exceeded" },
      },
    })
    await abortStarted.promise
    await lifecycle(userEvent(sessionID, "user-2"))
    abort.resolve(true)
    await staleMessage

    expect(retries).toEqual([])
    expect(deps.sessionStates.has(sessionID)).toBe(false)
  })

  it("#given an assistant error is resolving its agent #when a newer user turn arrives #then the stale message cannot create fallback state", async () => {
    const resolution = deferred<string | undefined>()
    const resolutionStarted = deferred<void>()
    const deps = createDeps()
    const retries: string[] = []
    const helpers: AutoRetryHelpers = {
      abortSessionRequest: async () => true,
      clearSessionFallbackTimeout: () => {},
      scheduleSessionFallbackTimeout: () => {},
      autoRetryWithFallback: async (_id, model) => { retries.push(model); return { accepted: true, status: "dispatched" } },
      resolveAgentForSessionFromContext: async () => { resolutionStarted.resolve(); return resolution.promise },
      cleanupStaleSessions: () => {},
    }
    const lifecycle = createEventHandler(deps, helpers)
    const messages = createMessageUpdateHandler(deps, helpers)
    const sessionID = "session-message-agent-generation"

    await lifecycle(userEvent(sessionID, "user-1"))
    const staleMessage = messages({
      info: {
        id: "assistant-error",
        role: "assistant",
        sessionID,
        agent: "sisyphus",
        model: "openai/primary",
        error: { statusCode: 503 },
      },
    })
    await resolutionStarted.promise
    await lifecycle(userEvent(sessionID, "user-2"))
    resolution.resolve("sisyphus")
    await staleMessage

    expect(retries).toEqual([])
    expect(deps.sessionStates.has(sessionID)).toBe(false)
  })
})
