/// <reference types="bun-types" />
import { afterEach, describe, expect, test } from "bun:test"

import { isAmbiguousPostDispatchPromptFailure } from "./prompt-failure-classifier"
import {
  _setPromptGateMessagesFetchTimeoutMsForTesting,
  dispatchInternalPrompt,
  releaseAllPromptAsyncReservationsForTesting,
} from "./prompt-async-gate"

type RecordingSession = {
  status(this: RecordingSession): Promise<object>
  messages(this: RecordingSession, _input: unknown): Promise<{ data: unknown[] }>
  promptAsync(this: RecordingSession, _input: unknown): Promise<{ ok: boolean }>
}

function makeRecordingClient() {
  const callRecords: Array<{ method: string; receiverIsSession: boolean }> = []

  const session: RecordingSession = {
    async status(this: RecordingSession) {
      callRecords.push({ method: "status", receiverIsSession: this === session })
      return {}
    },
    async messages(this: RecordingSession, _input: unknown) {
      callRecords.push({ method: "messages", receiverIsSession: this === session })
      return { data: [] }
    },
    async promptAsync(this: RecordingSession, _input: unknown) {
      callRecords.push({ method: "promptAsync", receiverIsSession: this === session })
      return { ok: true }
    },
  }

  const client = { session }
  return { client, session, callRecords }
}

describe("prompt-async-gate client-identity characterization", () => {
  afterEach(() => {
    //#then
    _setPromptGateMessagesFetchTimeoutMsForTesting(undefined)
    releaseAllPromptAsyncReservationsForTesting()
  })

  test("#given a recording fake client #when the gate dispatches #then status messages and promptAsync are all called on the same session object", async () => {
    //#given
    const { client, callRecords } = makeRecordingClient()

    //#when
    const result = await dispatchInternalPrompt({
      mode: "async",
      client,
      sessionID: "ses_identity_a",
      input: { path: { id: "ses_identity_a" }, body: { parts: [{ type: "text", text: "hi" }] } },
      source: "test:identity:a",
      settleMs: 0,
      postDispatchHoldMs: 0,
      checkStatus: true,
      checkToolState: true,
    })

    //#then
    expect(result.status).toBe("dispatched")
    const methodsCalled = callRecords.map((r) => r.method)
    expect(methodsCalled).toContain("promptAsync")
    for (const record of callRecords) {
      expect(record.receiverIsSession).toBe(true)
    }
  })

  test("#given checkStatus false and checkToolState false #when the gate dispatches #then status and messages are never invoked", async () => {
    //#given
    const { client, callRecords } = makeRecordingClient()

    //#when
    const result = await dispatchInternalPrompt({
      mode: "async",
      client,
      sessionID: "ses_identity_b",
      input: { path: { id: "ses_identity_b" }, body: { parts: [{ type: "text", text: "hi" }] } },
      source: "test:identity:b",
      settleMs: 0,
      postDispatchHoldMs: 0,
      checkStatus: false,
      checkToolState: false,
    })

    //#then
    expect(result.status).toBe("dispatched")
    const methodsCalled = callRecords.map((r) => r.method)
    expect(methodsCalled).not.toContain("status")
    expect(methodsCalled).not.toContain("messages")
    expect(methodsCalled).toContain("promptAsync")
  })

  test("#given session.status reports the session as busy #when the gate checks activity #then result is active and promptAsync is not called", async () => {
    //#given
    let promptCalled = false
    const client = {
      session: {
        status: async () => ({ data: { ses_identity_c: { type: "busy" } } }),
        messages: async () => ({ data: [] }),
        promptAsync: async () => {
          promptCalled = true
          return { ok: true }
        },
      },
    }

    //#when — queueBehavior "defer" is the path that returns "active" when session is busy
    const result = await dispatchInternalPrompt({
      mode: "async",
      client,
      sessionID: "ses_identity_c",
      input: { path: { id: "ses_identity_c" }, body: { parts: [{ type: "text", text: "hi" }] } },
      source: "test:identity:c",
      settleMs: 0,
      postDispatchHoldMs: 0,
      checkStatus: true,
      queueBehavior: "defer",
    })

    //#then
    expect(result).toEqual({ status: "active" })
    expect(promptCalled).toBe(false)
  })

  test("#given a dispatch hold is active #when a second dispatch arrives before the hold expires #then it is coalesced and reports reserved or queued", async () => {
    //#given
    let promptCalls = 0
    const client = {
      session: {
        promptAsync: async () => {
          promptCalls += 1
          return { ok: true }
        },
      },
    }
    const originalDateNow = Date.now
    let currentNow = originalDateNow()
    Date.now = () => currentNow

    try {
      //#when
      const first = await dispatchInternalPrompt({
        mode: "async",
        client,
        sessionID: "ses_identity_d",
        input: { path: { id: "ses_identity_d" }, body: { parts: [{ type: "text", text: "first" }] } },
        source: "test:identity:d:first",
        settleMs: 0,
        postDispatchHoldMs: 10_000,
      })

      const second = await dispatchInternalPrompt({
        mode: "async",
        client,
        sessionID: "ses_identity_d",
        input: { path: { id: "ses_identity_d" }, body: { parts: [{ type: "text", text: "first" }] } },
        source: "test:identity:d:second",
        settleMs: 0,
        postDispatchHoldMs: 10_000,
      })

      //#then
      expect(first.status).toBe("dispatched")
      expect(second.status).toSatisfy((s: string) => s === "queued" || s === "reserved")
      expect(promptCalls).toBe(1)
    } finally {
      Date.now = originalDateNow
    }
  })

  test("#given promptAsync rejects after dispatch was attempted #when the result is classified #then status is failed dispatchAttempted is true and isAmbiguousPostDispatchPromptFailure is true", async () => {
    //#given
    const client = {
      session: {
        promptAsync: async () => {
          throw new Error("unexpected eof while reading response")
        },
      },
    }

    //#when
    const result = await dispatchInternalPrompt({
      mode: "async",
      client,
      sessionID: "ses_identity_e",
      input: { path: { id: "ses_identity_e" }, body: { parts: [{ type: "text", text: "wake" }] } },
      source: "test:identity:e",
      settleMs: 0,
      postDispatchHoldMs: 0,
      checkStatus: false,
      checkToolState: false,
    })

    //#then
    expect(result.status).toBe("failed")
    if (result.status === "failed") {
      expect(result.dispatchAttempted).toBe(true)
      expect(isAmbiguousPostDispatchPromptFailure(result)).toBe(true)
    }
  })
})
