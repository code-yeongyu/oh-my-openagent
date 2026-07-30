import { expect, test } from "bun:test"

import { SessionCategoryRegistry } from "../../shared/session-category-registry"
import { createFallbackTimeoutHelpers } from "./auto-retry-timeout"
import { createFallbackState } from "./fallback-state"
import type { HookDeps, RuntimeFallbackPluginInput } from "./types"

function createContext(): RuntimeFallbackPluginInput {
  return {
    client: {
      session: {
        abort: async () => ({}),
        messages: async () => ({ data: [] }),
        promptAsync: async () => ({}),
      },
      tui: { showToast: async () => ({}) },
    },
    directory: "/test/dir",
  }
}

function createDeps(): HookDeps {
  return {
    ctx: createContext(),
    config: {
      enabled: true,
      retry_on_errors: [429, 503, 529],
      max_fallback_attempts: 3,
      cooldown_seconds: 60,
      timeout_seconds: 30,
      notify_on_fallback: true,
      restore_primary_after_cooldown: false,
    },
    options: { session_timeout_ms: 1 },
    pluginConfig: { categories: { test: { fallback_models: ["provider/fallback-one"] } } },
    sessionStates: new Map(),
    sessionLastAccess: new Map(),
    sessionRetryInFlight: new Set(),
    sessionRetryOwners: new Map(),
    sessionAwaitingFallbackResult: new Set(),
    sessionFallbackTimeouts: new Map(),
    sessionStatusRetryKeys: new Map(),
    internallyAbortedSessions: new Set(),
  }
}

test("stale same-generation timeout preserves replacement retry ownership", async () => {
  const sessionID = "same-generation-timeout-overlap"
  SessionCategoryRegistry.register(sessionID, "test")
  const deps = createDeps()
  const state = createFallbackState("provider/primary")
  state.pendingFallbackModel = "provider/fallback-one"
  state.pendingFallbackPromptMayHaveBeenAccepted = true
  deps.sessionStates.set(sessionID, state)

  let signalAbortStarted: (() => void) | undefined
  const abortStarted = new Promise<void>((resolve) => { signalAbortStarted = resolve })
  let resolveAbort: ((succeeded: boolean) => void) | undefined
  const abortResult = new Promise<boolean>((resolve) => { resolveAbort = resolve })
  let dispatchCount = 0
  const helpers = createFallbackTimeoutHelpers(
    deps,
    async () => {
      signalAbortStarted?.()
      return abortResult
    },
    async () => {
      dispatchCount += 1
      return { accepted: true, status: "dispatched" }
    },
  )

  helpers.scheduleSessionFallbackTimeout(sessionID)
  await abortStarted

  if (deps.options) deps.options.session_timeout_ms = 10_000
  const replacementOwner = Symbol("replacement-owner")
  deps.sessionRetryInFlight.add(sessionID)
  deps.sessionRetryOwners?.set(sessionID, replacementOwner)
  helpers.scheduleSessionFallbackTimeout(sessionID)
  const replacementTimer = deps.sessionFallbackTimeouts.get(sessionID)
  resolveAbort?.(true)
  await new Promise((resolve) => setTimeout(resolve, 0))

  expect(dispatchCount).toBe(0)
  expect(deps.sessionRetryInFlight.has(sessionID)).toBe(true)
  expect(deps.sessionRetryOwners?.get(sessionID)).toBe(replacementOwner)
  expect(deps.sessionFallbackTimeouts.get(sessionID)).toBe(replacementTimer)
  expect(state.currentModel).toBe("provider/primary")
  expect(state.pendingFallbackModel).toBe("provider/fallback-one")
  expect(state.pendingFallbackPromptMayHaveBeenAccepted).toBe(true)

  helpers.clearSessionFallbackTimeout(sessionID)
  SessionCategoryRegistry.clear()
})
