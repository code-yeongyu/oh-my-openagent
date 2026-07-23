import { describe, expect, it } from "bun:test"
import type { AutoRetryHelpers } from "./auto-retry"
import { createEventHandler } from "./event-handler"
import { createFirstPromptWatchdog } from "./first-prompt-watchdog"
import {
  AGENT,
  createDeps,
  PLUGIN_CONFIG_WITH_FALLBACK,
  PRIMARY_MODEL,
} from "./first-prompt-watchdog-test-helpers"
import { createFallbackState } from "./fallback-state"

type CancellationMode = "progress" | "status"

function createAbortEvent(sessionID: string) {
  return {
    event: {
      type: "session.error",
      properties: { sessionID, error: { name: "MessageAbortedError" } },
    },
  }
}

async function flushTasks(): Promise<void> {
  for (let attempt = 0; attempt < 12; attempt += 1) {
    await Promise.resolve()
  }
}

async function runThreeGenerationRace(cancellationMode: CancellationMode) {
  const sessionID = `session-three-generation-${cancellationMode}`
  const deps = createDeps(PLUGIN_CONFIG_WITH_FALLBACK)
  deps.sessionStates.set(sessionID, createFallbackState(PRIMARY_MODEL))
  let dispatchCount = 0
  let notifyFirstDispatch: (() => void) | undefined
  let notifySecondDispatch: (() => void) | undefined
  const firstDispatch = new Promise<void>((resolve) => {
    notifyFirstDispatch = resolve
  })
  const secondDispatch = new Promise<void>((resolve) => {
    notifySecondDispatch = resolve
  })
  const helpers: AutoRetryHelpers = {
    abortSessionRequest: async () => {
      deps.internallyAbortedSessions.add(sessionID)
      return true
    },
    clearSessionFallbackTimeout: () => {},
    scheduleSessionFallbackTimeout: () => {},
    autoRetryWithFallback: async () => {
      dispatchCount += 1
      if (dispatchCount === 1) notifyFirstDispatch?.()
      if (dispatchCount === 2) notifySecondDispatch?.()
      return { accepted: true, status: "dispatched" }
    },
    resolveAgentForSessionFromContext: async () => AGENT,
    cleanupStaleSessions: () => {},
  }
  const watchdog = createFirstPromptWatchdog(deps, helpers, 1)
  const eventHandler = createEventHandler(deps, helpers)

  watchdog.onUserMessage(sessionID, PRIMARY_MODEL, AGENT, "user-generation-1")
  await firstDispatch
  await flushTasks()

  deps.internallyAbortedSessions.delete(sessionID)
  watchdog.onUserMessage(sessionID, PRIMARY_MODEL, AGENT, "user-generation-2")
  expect(watchdog.onSessionTerminal(sessionID, "session.error", true)).toEqual({
    kind: "defer-terminal",
    sessionID,
  })
  if (cancellationMode === "progress") {
    expect(watchdog.onAssistantProgress(sessionID, "user-generation-2", true)).toEqual({
      kind: "resolve-terminal",
      sessionID,
    })
  } else {
    expect(watchdog.resolveDeferredTerminal(sessionID, false)).toEqual({
      kind: "resolve-terminal",
      sessionID,
    })
  }
  await eventHandler(createAbortEvent(sessionID))

  watchdog.onUserMessage(sessionID, PRIMARY_MODEL, AGENT, "user-generation-3")
  expect(watchdog.onSessionTerminal(sessionID, "session.error", true)).toEqual({
    kind: "defer-terminal",
    sessionID,
  })
  expect(watchdog.onAssistantProgress(sessionID, "user-generation-1", true)).toEqual({
    kind: "inspect-terminal",
    sessionID,
  })
  expect(watchdog.resolveDeferredTerminal(sessionID, true)).toEqual({
    kind: "resolve-terminal",
    sessionID,
  })
  await eventHandler(createAbortEvent(sessionID))
  await secondDispatch

  watchdog.dispose()
  return { deps, dispatchCount }
}

describe("first-prompt watchdog three-generation races", () => {
  it("#given generation one retains abort provenance #when progress cancels generation two before generation three arms #then generation three still recovers", async () => {
    const { deps, dispatchCount } = await runThreeGenerationRace("progress")

    expect(dispatchCount).toBe(2)
    expect(deps.sessionStates.values().next().value?.currentModel).not.toBe(PRIMARY_MODEL)
    expect(deps.sessionStates.values().next().value?.attemptCount).toBeGreaterThan(0)
  })

  it("#given generation one retains abort provenance #when status resolution cancels generation two before generation three arms #then generation three still recovers", async () => {
    const { deps, dispatchCount } = await runThreeGenerationRace("status")

    expect(dispatchCount).toBe(2)
    expect(deps.sessionStates.values().next().value?.currentModel).not.toBe(PRIMARY_MODEL)
    expect(deps.sessionStates.values().next().value?.attemptCount).toBeGreaterThan(0)
  })
})
