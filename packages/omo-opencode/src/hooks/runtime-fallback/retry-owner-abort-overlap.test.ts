import { afterEach, expect, test } from "bun:test"

import { SessionCategoryRegistry } from "../../shared/session-category-registry"
import type { AutoRetryHelpers } from "./auto-retry"
import { createMessageUpdateHandler } from "./message-update-handler"
import { createSessionStatusHandler } from "./session-status-handler"
import type { HookDeps, RuntimeFallbackPluginInput } from "./types"

const SESSION_ID = "retry-owner-abort-overlap"
const FALLBACK_MODEL = "provider/fallback"

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
      notify_on_fallback: false,
      restore_primary_after_cooldown: false,
    },
    options: undefined,
    pluginConfig: {
      categories: { test: { fallback_models: [FALLBACK_MODEL] } },
    },
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

function createDeferredAbortHelpers(dispatches: string[]) {
  let signalAbortStarted: (() => void) | undefined
  const abortStarted = new Promise<void>((resolve) => { signalAbortStarted = resolve })
  let resolveAbort: ((succeeded: boolean) => void) | undefined
  const abortResult = new Promise<boolean>((resolve) => { resolveAbort = resolve })
  const helpers: AutoRetryHelpers = {
    abortSessionRequest: async () => {
      signalAbortStarted?.()
      return abortResult
    },
    clearSessionFallbackTimeout: () => {},
    scheduleSessionFallbackTimeout: () => {},
    autoRetryWithFallback: async (_sessionID, model) => {
      dispatches.push(model)
      return { accepted: true, status: "dispatched" }
    },
    resolveAgentForSessionFromContext: async () => undefined,
    cleanupStaleSessions: () => {},
  }
  return { abortStarted, helpers, resolveAbort: (succeeded: boolean) => resolveAbort?.(succeeded) }
}

function installOriginalOwner(deps: HookDeps): void {
  deps.sessionRetryInFlight.add(SESSION_ID)
  deps.sessionRetryOwners?.set(SESSION_ID, Symbol("original-owner"))
}

function installReplacementOwner(deps: HookDeps): symbol {
  const replacementOwner = Symbol("replacement-owner")
  deps.sessionRetryInFlight.add(SESSION_ID)
  deps.sessionRetryOwners?.set(SESSION_ID, replacementOwner)
  return replacementOwner
}

afterEach(() => {
  SessionCategoryRegistry.clear()
})

test("stale session status abort preserves replacement retry ownership", async () => {
  SessionCategoryRegistry.register(SESSION_ID, "test")
  const deps = createDeps()
  const dispatches: string[] = []
  installOriginalOwner(deps)
  const deferred = createDeferredAbortHelpers(dispatches)
  const handler = createSessionStatusHandler(deps, deferred.helpers)

  const handling = handler({
    sessionID: SESSION_ID,
    model: "provider/primary",
    status: { type: "retry", attempt: 2, message: "rate limit, retrying in 30 seconds" },
  })
  await deferred.abortStarted
  const replacementOwner = installReplacementOwner(deps)
  deferred.resolveAbort(true)
  await handling

  expect(dispatches).toEqual([])
  expect(deps.sessionRetryInFlight.has(SESSION_ID)).toBe(true)
  expect(deps.sessionRetryOwners?.get(SESSION_ID)).toBe(replacementOwner)
})

test("stale message retry abort preserves replacement retry ownership", async () => {
  SessionCategoryRegistry.register(SESSION_ID, "test")
  const deps = createDeps()
  const dispatches: string[] = []
  installOriginalOwner(deps)
  const deferred = createDeferredAbortHelpers(dispatches)
  const handler = createMessageUpdateHandler(deps, deferred.helpers)

  const handling = handler({
    sessionID: SESSION_ID,
    info: {
      role: "assistant",
      model: "provider/primary",
      message: "rate limit, retrying in 30 seconds",
      error: { name: "ProviderRateLimitError", message: "rate limit, retrying in 30 seconds" },
    },
  })
  await deferred.abortStarted
  const replacementOwner = installReplacementOwner(deps)
  deferred.resolveAbort(true)
  await handling

  expect(dispatches).toEqual([])
  expect(deps.sessionRetryInFlight.has(SESSION_ID)).toBe(true)
  expect(deps.sessionRetryOwners?.get(SESSION_ID)).toBe(replacementOwner)
})
