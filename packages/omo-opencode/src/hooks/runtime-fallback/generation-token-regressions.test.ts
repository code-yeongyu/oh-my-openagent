import { describe, expect, it } from "bun:test"

import { createAutoRetryDispatcher } from "./auto-retry-dispatch"
import { clearSessionRetryOwnership } from "./session-retry-ownership"
import { createDeps, PLUGIN_CONFIG_WITH_FALLBACK } from "./first-prompt-watchdog-test-helpers"
import { createWatchdogAbortProvenance } from "./watchdog-abort-provenance"

function deferred<T>() {
  let resolvePromise: ((value: T) => void) | undefined
  const promise = new Promise<T>((resolve) => { resolvePromise = resolve })
  return { promise, resolve: (value: T) => resolvePromise?.(value) }
}

describe("runtime-fallback generation token cleanup", () => {
  it("#given a replacement payload fetch #when the stale fetch settles #then its cleanup preserves the replacement token", async () => {
    const sessionID = "payload-token-replacement"
    const firstMessages = deferred<{ data: [] }>()
    const secondMessages = deferred<{ data: [] }>()
    const deps = createDeps(PLUGIN_CONFIG_WITH_FALLBACK)
    let messageCalls = 0
    deps.ctx.client.session.messages = async () => {
      messageCalls += 1
      return messageCalls === 1 ? firstMessages.promise : secondMessages.promise
    }
    const dispatch = createAutoRetryDispatcher(deps, () => {}, () => {})

    const first = dispatch(sessionID, "anthropic/claude-haiku-4-5", undefined, "first")
    await Promise.resolve()
    const firstToken = deps.sessionRetryPayloadPending?.get(sessionID)
    clearSessionRetryOwnership(deps, sessionID)
    const second = dispatch(sessionID, "anthropic/claude-haiku-4-5", undefined, "second")
    await Promise.resolve()
    const secondToken = deps.sessionRetryPayloadPending?.get(sessionID)

    expect(secondToken).not.toBe(firstToken)
    firstMessages.resolve({ data: [] })
    await first
    expect(deps.sessionRetryPayloadPending?.get(sessionID)).toBe(secondToken)

    clearSessionRetryOwnership(deps, sessionID)
    secondMessages.resolve({ data: [] })
    await second
  })

  it("#given a newer watchdog response marker #when stale cleanup runs #then the newer generation remains pending", () => {
    const provenance = createWatchdogAbortProvenance()
    const sessionID = "watchdog-response-generation"

    provenance.markResponsePending(sessionID, 1)
    provenance.markResponsePending(sessionID, 2)
    provenance.clearResponsePending(sessionID, 1)

    expect(provenance.isResponsePending(sessionID)).toBe(true)
    provenance.clearResponsePending(sessionID, 2)
    expect(provenance.isResponsePending(sessionID)).toBe(false)
  })
})
