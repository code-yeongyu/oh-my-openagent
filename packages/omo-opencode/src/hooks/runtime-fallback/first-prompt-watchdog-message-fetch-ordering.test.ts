import { describe, expect, it } from "bun:test"
import type { AutoRetryHelpers } from "./auto-retry"
import { createAutoRetryHelpers } from "./auto-retry"
import { createEventHandler } from "./event-handler"
import { createFirstPromptWatchdog, observeEventForWatchdog } from "./first-prompt-watchdog"
import {
  AGENT,
  createDeps,
  FALLBACK_MODEL,
  PLUGIN_CONFIG_WITH_FALLBACK,
  PRIMARY_MODEL,
} from "./first-prompt-watchdog-test-helpers"

function createDeferred<T>(): {
  readonly promise: Promise<T>
  readonly resolve: (value: T) => void
} {
  let resolvePromise: ((value: T) => void) | undefined
  const promise = new Promise<T>((resolve) => {
    resolvePromise = resolve
  })
  return {
    promise,
    resolve: (value) => resolvePromise?.(value),
  }
}

describe("first-prompt watchdog message-fetch ordering", () => {
  it("#given abort resolved while retry messages are pending #when its terminal arrives #then fallback ownership survives through dispatch", async () => {
    const sessionID = "session-watchdog-message-fetch-pending"
    const deps = createDeps(PLUGIN_CONFIG_WITH_FALLBACK)
    const messagesResponse = createDeferred<{ readonly data: readonly [] }>()
    const messagesStarted = createDeferred<void>()
    const promptDispatched = createDeferred<void>()
    const abortSources: string[] = []
    let promptCalls = 0

    deps.ctx.client.session.abort = async () => ({})
    deps.ctx.client.session.messages = async () => {
      messagesStarted.resolve()
      return messagesResponse.promise
    }
    deps.ctx.client.session.promptAsync = async () => {
      promptCalls += 1
      promptDispatched.resolve()
      return {}
    }

    const baseHelpers = createAutoRetryHelpers(deps)
    const helpers: AutoRetryHelpers = {
      ...baseHelpers,
      abortSessionRequest: async (ownedSessionID, source) => {
        abortSources.push(source)
        return baseHelpers.abortSessionRequest(ownedSessionID, source)
      },
      resolveAgentForSessionFromContext: async () => AGENT,
    }
    const watchdog = createFirstPromptWatchdog(deps, helpers, 1)
    const eventHandler = createEventHandler(deps, helpers)
    const abortEvent = {
      type: "session.error",
      properties: { sessionID, error: { name: "MessageAbortedError" } },
    }

    watchdog.onUserMessage(sessionID, PRIMARY_MODEL, AGENT, "user-1")
    await messagesStarted.promise

    expect(deps.sessionRetryPayloadPending?.has(sessionID)).toBe(true)
    const decision = observeEventForWatchdog(abortEvent, watchdog)
    if (decision?.kind !== "consume-terminal") {
      await eventHandler({ event: abortEvent })
    }

    expect(decision).toEqual({ kind: "consume-terminal", sessionID })
    expect(deps.internallyAbortedSessions.has(sessionID)).toBe(true)

    messagesResponse.resolve({ data: [] })
    await promptDispatched.promise
    for (let attempt = 0; attempt < 10; attempt += 1) await Promise.resolve()

    expect(promptCalls).toBe(1)
    expect(abortSources).toEqual(["first-prompt-watchdog"])
    expect(deps.sessionRetryPayloadPending?.has(sessionID)).toBe(false)
    expect(deps.sessionStates.get(sessionID)?.currentModel).toBe(FALLBACK_MODEL)
    expect(deps.sessionAwaitingFallbackResult.has(sessionID)).toBe(true)
    watchdog.dispose()
  })
})
