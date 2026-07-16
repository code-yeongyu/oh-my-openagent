import { describe, expect, it } from "bun:test"
import type { AutoRetryHelpers } from "./auto-retry"
import { createEventHandler } from "./event-handler"
import { createFirstPromptWatchdog } from "./first-prompt-watchdog"
import {
  AGENT,
  createDeps,
  installFakeTimers,
  PLUGIN_CONFIG_WITH_FALLBACK,
  PRIMARY_MODEL,
} from "./first-prompt-watchdog-test-helpers"
import { createFallbackState } from "./fallback-state"

function createAbortEvent(sessionID: string) {
  return {
    event: {
      type: "session.error",
      properties: { sessionID, error: { name: "MessageAbortedError" } },
    },
  }
}

describe("first-prompt watchdog suspended generation ownership", () => {
  it("#given generation two is suspended by generation one's delayed abort #when generation three arrives before correlation resolves #then generation three receives a fresh deadline", async () => {
    const timers = installFakeTimers()
    const sessionID = "session-suspended-generation-transfer"
    const deps = createDeps(PLUGIN_CONFIG_WITH_FALLBACK)
    deps.sessionStates.set(sessionID, createFallbackState(PRIMARY_MODEL))
    let abortCount = 0
    let dispatchCount = 0
    const helpers: AutoRetryHelpers = {
      abortSessionRequest: async () => {
        abortCount += 1
        deps.internallyAbortedSessions.add(sessionID)
        return true
      },
      clearSessionFallbackTimeout: () => {},
      scheduleSessionFallbackTimeout: () => {},
      autoRetryWithFallback: async () => {
        dispatchCount += 1
        return { accepted: true, status: "dispatched" }
      },
      resolveAgentForSessionFromContext: async () => AGENT,
      cleanupStaleSessions: () => {},
    }
    const watchdog = createFirstPromptWatchdog(deps, helpers, 30)
    const eventHandler = createEventHandler(deps, helpers)

    try {
      watchdog.onUserMessage(sessionID, PRIMARY_MODEL, AGENT, "user-generation-1")
      await timers.advanceBy(30)
      expect(abortCount).toBe(1)
      expect(dispatchCount).toBe(1)

      deps.internallyAbortedSessions.delete(sessionID)
      watchdog.onUserMessage(sessionID, PRIMARY_MODEL, AGENT, "user-generation-2")
      await timers.advanceBy(22)
      expect(watchdog.onSessionTerminal(sessionID, "session.error", true)).toEqual({
        kind: "defer-terminal",
        sessionID,
      })

      watchdog.onUserMessage(sessionID, PRIMARY_MODEL, AGENT, "user-generation-3")
      expect(watchdog.onAssistantProgress(sessionID, "user-generation-1", true)).toEqual({
        kind: "inspect-terminal",
        sessionID,
      })
      expect(watchdog.resolveDeferredTerminal(sessionID, true)).toEqual({
        kind: "resolve-terminal",
        sessionID,
      })
      await eventHandler(createAbortEvent(sessionID))

      await timers.advanceBy(8)
      expect(abortCount).toBe(1)
      await timers.advanceBy(22)
      expect(abortCount).toBe(2)
    } finally {
      watchdog.dispose()
      timers.restore()
    }
  })
})
