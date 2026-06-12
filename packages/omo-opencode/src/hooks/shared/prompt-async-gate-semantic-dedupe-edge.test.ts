/// <reference path="../../../../../bun-test.d.ts" />
import { afterEach, describe, expect, test } from "bun:test"

import { createSemanticPromptDedupeKey } from "../../shared/prompt-async-gate/semantic-dedupe"
import {
  dispatchInternalPrompt,
  releaseAllPromptAsyncReservationsForTesting,
  releasePromptAsyncReservation,
} from "./prompt-async-gate"

describe("semantic prompt dedupe key", () => {
  test("#given cyclic prompt inputs #when dedupe keys are created #then equivalent cycles are stable and do not throw", () => {
    // given
    const firstPrompt: Record<string, unknown> = {
      body: { parts: [{ type: "text", text: "continue" }] },
      path: { id: "ses_cycle" },
    }
    firstPrompt.self = firstPrompt

    const secondPrompt: Record<string, unknown> = {
      path: { id: "ses_cycle" },
      self: undefined,
      body: { parts: [{ text: "continue", type: "text" }] },
    }
    secondPrompt.self = secondPrompt

    // when
    const firstKey = createSemanticPromptDedupeKey(firstPrompt)
    const secondKey = createSemanticPromptDedupeKey(secondPrompt)

    // then
    expect(firstKey).toBe(secondKey)
  })
})

describe("dispatchInternalPrompt semantic dedupe edge cases", () => {
  afterEach(() => {
    // then
    releaseAllPromptAsyncReservationsForTesting()
  })

  test("#given promptAsync rejects after an attempted dispatch #when the same prompt retries after the post-dispatch hold #then semantic dedupe still coalesces it", async () => {
    // given
    const promptCalls: string[] = []
    const originalDateNow = Date.now
    let currentNow = originalDateNow()
    Date.now = () => currentNow
    const input = {
      path: { id: "ses_reject_after_attempt_semantic" },
      body: { parts: [{ type: "text", text: "continue after failed accept" }] },
      query: { directory: "/workspace/project" },
    }
    const client = {
      session: {
        promptAsync: async () => {
          promptCalls.push("prompt")
          if (promptCalls.length === 1) {
            throw new Error("post-dispatch failure")
          }
          return { accepted: true }
        },
      },
    }

    try {
      // when
      const first = await dispatchInternalPrompt({
        mode: "async",
        client,
        sessionID: "ses_reject_after_attempt_semantic",
        input,
        source: "test:reject-semantic:first",
        settleMs: 0,
        postDispatchHoldMs: 1,
        semanticDedupeHoldMs: 100,
      })
      currentNow += 2
      const second = await dispatchInternalPrompt({
        mode: "async",
        client,
        sessionID: "ses_reject_after_attempt_semantic",
        input,
        source: "test:reject-semantic:second",
        settleMs: 0,
        postDispatchHoldMs: 1,
        semanticDedupeHoldMs: 100,
      })

      // then
      if (first.status !== "failed") {
        throw new Error("expected first dispatch to fail after attempt")
      }
      expect(first.dispatchAttempted).toBe(true)
      expect(second).toEqual({ status: "queued", queuedBy: "test:reject-semantic:first", position: 0 })
      expect(promptCalls).toEqual(["prompt"])
    } finally {
      Date.now = originalDateNow
    }
  })

  test("#given a failed attempted dispatch is intentionally released #when the same prompt retries inside the semantic window #then it can dispatch again", async () => {
    // given
    const promptCalls: string[] = []
    const originalDateNow = Date.now
    let currentNow = originalDateNow()
    Date.now = () => currentNow
    const input = {
      path: { id: "ses_reject_after_attempt_release" },
      body: { parts: [{ type: "text", text: "continue after release" }] },
      query: { directory: "/workspace/project" },
    }
    const client = {
      session: {
        promptAsync: async () => {
          promptCalls.push("prompt")
          if (promptCalls.length === 1) {
            throw new Error("post-dispatch failure")
          }
          return { accepted: true }
        },
      },
    }

    try {
      // when
      const first = await dispatchInternalPrompt({
        mode: "async",
        client,
        sessionID: "ses_reject_after_attempt_release",
        input,
        source: "test:reject-release:first",
        settleMs: 0,
        postDispatchHoldMs: 100,
        semanticDedupeHoldMs: 1_000,
      })
      const released = releasePromptAsyncReservation(
        "ses_reject_after_attempt_release",
        "test:reject-release:first",
      )
      currentNow += 2
      const second = await dispatchInternalPrompt({
        mode: "async",
        client,
        sessionID: "ses_reject_after_attempt_release",
        input,
        source: "test:reject-release:second",
        settleMs: 0,
        postDispatchHoldMs: 100,
        semanticDedupeHoldMs: 1_000,
      })

      // then
      if (first.status !== "failed") {
        throw new Error("expected first dispatch to fail after attempt")
      }
      expect(first.dispatchAttempted).toBe(true)
      expect(released).toBe(true)
      expect(second.status).toBe("dispatched")
      expect(promptCalls).toEqual(["prompt", "prompt"])
    } finally {
      Date.now = originalDateNow
    }
  })
})
