import { describe, expect, it } from "bun:test"
import type { AutoRetryHelpers } from "./auto-retry"
import { createEventHandler } from "./event-handler"
import { createFallbackState } from "./fallback-state"
import type { HookDeps, RuntimeFallbackPluginInput } from "./types"

function deferred<T>() {
  let resolvePromise: ((value: T) => void) | undefined
  const promise = new Promise<T>((resolve) => { resolvePromise = resolve })
  return { promise, resolve: (value: T) => resolvePromise?.(value) }
}

function createDeps(): HookDeps {
  const ctx: RuntimeFallbackPluginInput = {
    client: {
      session: {
        abort: async () => ({}),
        messages: async () => ({ data: [] }),
        promptAsync: async () => ({}),
      },
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
    pluginConfig: {},
    sessionStates: new Map(),
    sessionLastAccess: new Map(),
    sessionRetryInFlight: new Set(),
    sessionAwaitingFallbackResult: new Set(),
    sessionFallbackTimeouts: new Map(),
    sessionStatusRetryKeys: new Map(),
    internallyAbortedSessions: new Set(),
  }
}

describe("runtime-fallback session.stop generation ownership", () => {
  it("#given stop awaits an old abort #when the ID is deleted and reused #then stale stop cannot clear replacement retry state", async () => {
    const abort = deferred<boolean>()
    const abortStarted = deferred<void>()
    const deps = createDeps()
    const helpers: AutoRetryHelpers = {
      abortSessionRequest: async () => { abortStarted.resolve(); return abort.promise },
      clearSessionFallbackTimeout: () => {},
      scheduleSessionFallbackTimeout: () => {},
      autoRetryWithFallback: async () => ({ accepted: true, status: "dispatched" }),
      resolveAgentForSessionFromContext: async () => undefined,
      cleanupStaleSessions: () => {},
    }
    const handler = createEventHandler(deps, helpers)
    const sessionID = "session-stop-reused"
    deps.sessionStates.set(sessionID, createFallbackState("openai/old-primary"))
    deps.sessionRetryInFlight.add(sessionID)

    const staleStop = handler({ event: { type: "session.stop", properties: { sessionID } } })
    await abortStarted.promise
    await handler({ event: { type: "session.deleted", properties: { sessionID } } })
    await handler({
      event: { type: "message.updated", properties: { info: { id: "replacement-user", role: "user", sessionID } } },
    })
    const replacementState = createFallbackState("openai/new-primary")
    replacementState.currentModel = "openai/new-fallback"
    replacementState.fallbackIndex = 0
    deps.sessionStates.set(sessionID, replacementState)
    deps.sessionRetryInFlight.add(sessionID)
    deps.sessionStatusRetryKeys.set(sessionID, "replacement:1")
    abort.resolve(true)
    await staleStop

    expect(deps.sessionStates.get(sessionID)).toBe(replacementState)
    expect(deps.sessionRetryInFlight.has(sessionID)).toBe(true)
    expect(deps.sessionStatusRetryKeys.get(sessionID)).toBe("replacement:1")
  })
})
