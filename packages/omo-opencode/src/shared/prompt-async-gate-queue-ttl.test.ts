import { afterEach, describe, expect, test } from "bun:test"

import {
  dispatchInternalPrompt,
  releaseAllPromptAsyncReservationsForTesting,
  releasePromptAsyncReservation,
} from "./prompt-async-gate"
import type { InternalPromptDispatchResult } from "./prompt-async-gate"

async function waitUntil(predicate: () => boolean, timeoutMs: number): Promise<void> {
  const startedAt = Date.now()
  while (!predicate()) {
    if (Date.now() - startedAt >= timeoutMs) {
      return
    }
    await new Promise((resolve) => setTimeout(resolve, 5))
  }
}

describe("prompt-async-gate queue TTL", () => {
  afterEach(() => {
    releaseAllPromptAsyncReservationsForTesting()
  })

  test("#given a queued prompt to a session that never goes idle #when the per-entry TTL elapses #then the entry expires and the onExpiredOrFailed channel reports it", async () => {
    // given
    let promptCalls = 0
    const client = {
      session: {
        status: async () => ({ data: { ses_ttl_busy: { type: "busy" } } }),
        promptAsync: async () => {
          promptCalls += 1
        },
      },
    }
    const settled: InternalPromptDispatchResult[] = []

    // when
    const result = await dispatchInternalPrompt({
      mode: "async",
      client,
      sessionID: "ses_ttl_busy",
      input: { path: { id: "ses_ttl_busy" }, body: { parts: [{ type: "text", text: "wedged" }] } },
      source: "test:ttl-busy",
      settleMs: 0,
      queueRetryMs: 5,
      ttlMs: 40,
      onExpiredOrFailed: (settledResult) => {
        settled.push(settledResult)
      },
    })
    await waitUntil(() => settled.length > 0, 1_000)

    // then
    expect(result.status).toBe("queued")
    expect(settled).toHaveLength(1)
    expect(settled[0]?.status).toBe("expired")
    if (settled[0]?.status === "expired") {
      expect(settled[0].source).toBe("test:ttl-busy")
      expect(settled[0].waitedMs).toBeGreaterThanOrEqual(40)
    }
    expect(promptCalls).toBe(0)
  })

  test("#given a stale queued prompt expired #when a fresh prompt targets the same idle session #then the gate dispatches it (queue blocker cleared)", async () => {
    // given
    let status = "busy"
    let promptCalls = 0
    const client = {
      session: {
        status: async () => ({ data: { ses_ttl_unblock: { type: status } } }),
        promptAsync: async () => {
          promptCalls += 1
        },
      },
    }
    const expired: InternalPromptDispatchResult[] = []

    // when - first prompt wedges against a busy session and expires
    await dispatchInternalPrompt({
      mode: "async",
      client,
      sessionID: "ses_ttl_unblock",
      input: { path: { id: "ses_ttl_unblock" }, body: { parts: [{ type: "text", text: "stale" }] } },
      source: "test:ttl-unblock:stale",
      settleMs: 0,
      queueRetryMs: 5,
      ttlMs: 40,
      onExpiredOrFailed: (settledResult) => {
        expired.push(settledResult)
      },
    })
    await waitUntil(() => expired.length > 0, 1_000)

    // session becomes idle, a brand new prompt should no longer be blocked
    status = "idle"
    let freshPromptSeen: (() => void) | undefined
    const freshPromptDispatched = new Promise<void>((resolve) => {
      freshPromptSeen = resolve
    })
    client.session.promptAsync = async () => {
      promptCalls += 1
      freshPromptSeen?.()
    }
    await dispatchInternalPrompt({
      mode: "async",
      client,
      sessionID: "ses_ttl_unblock",
      input: { path: { id: "ses_ttl_unblock" }, body: { parts: [{ type: "text", text: "fresh" }] } },
      source: "test:ttl-unblock:fresh",
      settleMs: 0,
      queueRetryMs: 5,
    })
    await freshPromptDispatched

    // then
    expect(expired[0]?.status).toBe("expired")
    expect(promptCalls).toBe(1)
  })

  test("#given a detached queued prompt whose dispatch fails #when the queue drains it #then the onExpiredOrFailed channel reports the failure", async () => {
    // given
    const client = {
      session: {
        promptAsync: async (input: { body: { parts: Array<{ text: string }> } }) => {
          const text = input.body.parts[0]?.text
          if (text === "second") {
            throw new Error("promptAsync boom")
          }
        },
      },
    }
    const settled: InternalPromptDispatchResult[] = []

    // when - first holds a post-dispatch reservation, second queues behind it
    const first = await dispatchInternalPrompt({
      mode: "async",
      client,
      sessionID: "ses_queue_fail",
      input: { path: { id: "ses_queue_fail" }, body: { parts: [{ type: "text", text: "first" }] } },
      source: "test:queue-fail:first",
      settleMs: 0,
    })
    const second = await dispatchInternalPrompt({
      mode: "async",
      client,
      sessionID: "ses_queue_fail",
      input: { path: { id: "ses_queue_fail" }, body: { parts: [{ type: "text", text: "second" }] } },
      source: "test:queue-fail:second",
      settleMs: 0,
      queueRetryMs: 5,
      onExpiredOrFailed: (settledResult) => {
        settled.push(settledResult)
      },
    })
    // releasing the first reservation triggers the detached drain of the second
    releasePromptAsyncReservation("ses_queue_fail", "test:queue-fail:first", {
      reservedBy: "test:queue-fail:first",
    })
    await waitUntil(() => settled.length > 0, 1_000)

    // then
    expect(first.status).toBe("dispatched")
    expect(second.status).toBe("queued")
    expect(settled).toHaveLength(1)
    expect(settled[0]?.status).toBe("failed")
  })
})
