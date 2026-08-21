import { describe, expect, it } from "bun:test"
import type { HookDeps, RuntimeFallbackPluginInput } from "./types"
import { createFallbackState } from "./fallback-state"
import { createStaleSessionCleanup } from "./auto-retry-cleanup"

function createContext(): RuntimeFallbackPluginInput {
  return {
    client: {
      session: {
        abort: async () => ({}),
        messages: async () => ({ data: [] }),
        promptAsync: async () => ({}),
      },
      tui: {
        showToast: async () => ({}),
      },
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
      max_fallback_attempts: 4,
      cooldown_seconds: 60,
      timeout_seconds: 30,
      notify_on_fallback: false,
      restore_primary_after_cooldown: false,
    },
    options: undefined,
    pluginConfig: undefined,
    sessionStates: new Map(),
    sessionLastAccess: new Map(),
    sessionRetryInFlight: new Set(),
    sessionAwaitingFallbackResult: new Set(),
    sessionFallbackTimeouts: new Map(),
    sessionStatusRetryKeys: new Map(),
    internallyAbortedSessions: new Set(),
  }
}

describe("createStaleSessionCleanup", () => {
  it("#given active and stale fallback sessions #when cleanup runs #then it retains state for twelve hours", () => {
    // given
    const deps = createDeps()
    const activeSessionID = "active-session"
    const staleSessionID = "stale-session"
    const now = Date.now()
    deps.sessionStates.set(activeSessionID, createFallbackState("openai/gpt-5.4"))
    deps.sessionStates.set(staleSessionID, createFallbackState("openai/gpt-5.4"))
    deps.sessionLastAccess.set(activeSessionID, now - 31 * 60 * 1000)
    deps.sessionLastAccess.set(staleSessionID, now - 13 * 60 * 60 * 1000)
    const clearedTimeouts: string[] = []
    const cleanup = createStaleSessionCleanup(deps, (sessionID) => {
      clearedTimeouts.push(sessionID)
    })

    // when
    cleanup()

    // then
    expect(deps.sessionStates.has(activeSessionID)).toBe(true)
    expect(deps.sessionStates.has(staleSessionID)).toBe(false)
    expect(clearedTimeouts).toEqual([staleSessionID])
  })
})
