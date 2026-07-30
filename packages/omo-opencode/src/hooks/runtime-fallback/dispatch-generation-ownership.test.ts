import { describe, expect, it } from "bun:test"
import { createAutoRetryHelpers } from "./auto-retry"
import { createFallbackState } from "./fallback-state"
import { bumpSessionGeneration } from "./session-generation"
import type { HookDeps, RuntimeFallbackPluginInput } from "./types"

function deferred<T>() {
  let resolvePromise: ((value: T) => void) | undefined
  const promise = new Promise<T>((resolve) => { resolvePromise = resolve })
  return { promise, resolve: (value: T) => resolvePromise?.(value) }
}

function createDeps(session: RuntimeFallbackPluginInput["client"]["session"]): HookDeps {
  return {
    ctx: { client: { session, tui: { showToast: async () => ({}) } }, directory: "/tmp" },
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

const messagesResponse = {
  data: [{ info: { role: "user" }, parts: [{ type: "text", text: "retry" }] }],
}

describe("runtime-fallback dispatch generation ownership", () => {
  it("#given message loading belongs to an old generation #when a newer user turn arrives #then stale dispatch releases retry ownership", async () => {
    const messages = deferred<unknown>()
    const deps = createDeps({
      abort: async () => ({}),
      messages: async () => messages.promise,
      promptAsync: async () => ({}),
    })
    const sessionID = "session-stale-dispatch-owner"
    deps.sessionStates.set(sessionID, createFallbackState("openai/primary"))
    const dispatch = createAutoRetryHelpers(deps).autoRetryWithFallback(
      sessionID,
      "openai/fallback",
      undefined,
      "watchdog",
    )

    bumpSessionGeneration(deps, sessionID)
    messages.resolve(messagesResponse)

    expect(await dispatch).toEqual({ accepted: false, status: "blocked", reason: "session lifecycle changed" })
    expect(deps.sessionRetryInFlight.has(sessionID)).toBe(false)
  })

  it("#given a fallback prompt is accepted #when its user event advances generation before promptAsync resolves #then accepted ownership is committed and released", async () => {
    const prompt = deferred<unknown>()
    const promptStarted = deferred<void>()
    const deps = createDeps({
      abort: async () => ({}),
      messages: async () => messagesResponse,
      promptAsync: async () => { promptStarted.resolve(); return prompt.promise },
    })
    const sessionID = "session-accepted-dispatch-generation"
    const state = createFallbackState("openai/primary")
    state.pendingFallbackModel = "openai/fallback"
    deps.sessionStates.set(sessionID, state)
    const dispatch = createAutoRetryHelpers(deps).autoRetryWithFallback(
      sessionID,
      "openai/fallback",
      undefined,
      "watchdog",
    )

    await promptStarted.promise
    bumpSessionGeneration(deps, sessionID)
    prompt.resolve({})

    expect(await dispatch).toEqual({ accepted: true, status: "dispatched" })
    expect(deps.sessionRetryInFlight.has(sessionID)).toBe(false)
    expect(deps.sessionAwaitingFallbackResult.has(sessionID)).toBe(true)
  })
})
