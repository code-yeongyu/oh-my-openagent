/// <reference path="../../../bun-test.d.ts" />
import { afterEach, describe, expect, test } from "bun:test"

import {
  createInternalAgentContinuationTextPart,
  createInternalAgentTextPart,
} from "./internal-initiator-marker"
import {
  _setPromptGateMessagesFetchTimeoutMsForTesting,
  dispatchInternalPrompt,
  releaseAllPromptAsyncReservationsForTesting,
} from "./prompt-async-gate"

describe("dispatchInternalPrompt semantic dedupe", () => {
  afterEach(() => {
    // then
    _setPromptGateMessagesFetchTimeoutMsForTesting(undefined)
    releaseAllPromptAsyncReservationsForTesting()
  })

  test("#given the same semantic prompt returns from another source after the broad hold expires #when OpenCode has not surfaced the accepted turn #then the duplicate is coalesced", async () => {
    // given
    const promptCalls: string[] = []
    const originalDateNow = Date.now
    let currentNow = originalDateNow()
    Date.now = () => currentNow
    const input = {
      path: { id: "ses_semantic_duplicate" },
      body: { parts: [{ type: "text", text: "continue" }] },
      query: { directory: "/workspace/project" },
    }
    const client = {
      session: {
        promptAsync: async () => {
          promptCalls.push("prompt")
        },
      },
    }

    try {
      // when
      const first = await dispatchInternalPrompt({
        mode: "async",
        client,
        sessionID: "ses_semantic_duplicate",
        input,
        source: "test:semantic:first",
        settleMs: 0,
        postDispatchHoldMs: 1,
      })
      currentNow += 2
      const second = await dispatchInternalPrompt({
        mode: "async",
        client,
        sessionID: "ses_semantic_duplicate",
        input,
        source: "test:semantic:second",
        settleMs: 0,
        postDispatchHoldMs: 0,
      })

      // then
      expect(first.status).toBe("dispatched")
      expect(second).toEqual({ status: "queued", queuedBy: "test:semantic:first", position: 0 })
      expect(promptCalls).toEqual(["prompt"])
    } finally {
      Date.now = originalDateNow
    }
  })

  test("#given the same semantic prompt is built with different object key order #when it repeats during the broad hold #then the duplicate is coalesced", async () => {
    // given
    const promptCalls: string[] = []
    const originalDateNow = Date.now
    let currentNow = originalDateNow()
    Date.now = () => currentNow
    const client = {
      session: {
        promptAsync: async () => {
          promptCalls.push("prompt")
        },
      },
    }

    try {
      // when
      const first = await dispatchInternalPrompt({
        mode: "async",
        client,
        sessionID: "ses_semantic_key_order",
        input: {
          path: { id: "ses_semantic_key_order" },
          body: { parts: [{ type: "text", text: "continue" }], noReply: true },
          query: { directory: "/workspace/project" },
        },
        source: "test:semantic-order:first",
        settleMs: 0,
        postDispatchHoldMs: 1,
      })
      currentNow += 2
      const second = await dispatchInternalPrompt({
        mode: "async",
        client,
        sessionID: "ses_semantic_key_order",
        input: {
          query: { directory: "/workspace/project" },
          body: { noReply: true, parts: [{ text: "continue", type: "text" }] },
          path: { id: "ses_semantic_key_order" },
        },
        source: "test:semantic-order:second",
        settleMs: 0,
        postDispatchHoldMs: 0,
      })

      // then
      expect(first.status).toBe("dispatched")
      expect(second).toEqual({ status: "queued", queuedBy: "test:semantic-order:first", position: 0 })
      expect(promptCalls).toEqual(["prompt"])
    } finally {
      Date.now = originalDateNow
    }
  })

  test("#given a distinct semantic prompt follows the broad hold #when it targets the same session #then it still dispatches", async () => {
    // given
    const promptCalls: string[] = []
    const originalDateNow = Date.now
    let currentNow = originalDateNow()
    Date.now = () => currentNow
    const client = {
      session: {
        promptAsync: async (input: { body: { parts: Array<{ text: string }> } }) => {
          const text = input.body.parts[0]?.text
          if (text) {
            promptCalls.push(text)
          }
        },
      },
    }

    try {
      // when
      const first = await dispatchInternalPrompt({
        mode: "async",
        client,
        sessionID: "ses_semantic_distinct",
        input: {
          path: { id: "ses_semantic_distinct" },
          body: { parts: [{ type: "text", text: "continue first" }] },
          query: { directory: "/workspace/project" },
        },
        source: "test:semantic-distinct:first",
        settleMs: 0,
        postDispatchHoldMs: 1,
      })
      currentNow += 2
      const second = await dispatchInternalPrompt({
        mode: "async",
        client,
        sessionID: "ses_semantic_distinct",
        input: {
          path: { id: "ses_semantic_distinct" },
          body: { parts: [{ type: "text", text: "continue second" }] },
          query: { directory: "/workspace/project" },
        },
        source: "test:semantic-distinct:second",
        settleMs: 0,
        postDispatchHoldMs: 0,
      })

      // then
      expect(first.status).toBe("dispatched")
      expect(second.status).toBe("dispatched")
      expect(promptCalls).toEqual(["continue first", "continue second"])
    } finally {
      Date.now = originalDateNow
    }
  })

  test("#given distinct long prompts share the same prefix and length #when the second follows the broad hold #then it still dispatches", async () => {
    // given
    const promptCalls: string[] = []
    const originalDateNow = Date.now
    let currentNow = originalDateNow()
    Date.now = () => currentNow
    const longPrefix = "x".repeat(9000)
    const client = {
      session: {
        promptAsync: async (input: { body: { parts: Array<{ text: string }> } }) => {
          const text = input.body.parts[0]?.text
          if (text) {
            promptCalls.push(text)
          }
        },
      },
    }

    try {
      // when
      const first = await dispatchInternalPrompt({
        mode: "async",
        client,
        sessionID: "ses_semantic_long_distinct",
        input: {
          path: { id: "ses_semantic_long_distinct" },
          body: { parts: [{ type: "text", text: `${longPrefix}A` }] },
          query: { directory: "/workspace/project" },
        },
        source: "test:semantic-long:first",
        settleMs: 0,
        postDispatchHoldMs: 1,
      })
      currentNow += 2
      const second = await dispatchInternalPrompt({
        mode: "async",
        client,
        sessionID: "ses_semantic_long_distinct",
        input: {
          path: { id: "ses_semantic_long_distinct" },
          body: { parts: [{ type: "text", text: `${longPrefix}B` }] },
          query: { directory: "/workspace/project" },
        },
        source: "test:semantic-long:second",
        settleMs: 0,
        postDispatchHoldMs: 0,
      })

      // then
      expect(first.status).toBe("dispatched")
      expect(second.status).toBe("dispatched")
      expect(promptCalls).toEqual([`${longPrefix}A`, `${longPrefix}B`])
    } finally {
      Date.now = originalDateNow
    }
  })

  test("#given synthetic internal prompts lack continuation metadata #when their text differs after the broad hold #then semantic dedupe keeps them distinct", async () => {
    // given
    const promptCalls: string[] = []
    const originalDateNow = Date.now
    let currentNow = originalDateNow()
    Date.now = () => currentNow
    const sessionID = "ses_semantic_synthetic_non_continuation"
    const client = {
      session: {
        promptAsync: async (input: { body: { parts: Array<{ text: string }> } }) => {
          const text = input.body.parts[0]?.text
          if (text) {
            promptCalls.push(text)
          }
        },
      },
    }

    try {
      // when
      const first = await dispatchInternalPrompt({
        mode: "async",
        client,
        sessionID,
        input: {
          path: { id: sessionID },
          body: {
            parts: [{ ...createInternalAgentTextPart("internal route A"), synthetic: true }],
          },
        },
        source: "test:semantic-synthetic:first",
        settleMs: 0,
        postDispatchHoldMs: 1,
      })
      currentNow += 2
      const second = await dispatchInternalPrompt({
        mode: "async",
        client,
        sessionID,
        input: {
          path: { id: sessionID },
          body: {
            parts: [{ ...createInternalAgentTextPart("internal route B"), synthetic: true }],
          },
        },
        source: "test:semantic-synthetic:second",
        settleMs: 0,
        postDispatchHoldMs: 0,
      })

      // then
      expect(first.status).toBe("dispatched")
      expect(second.status).toBe("dispatched")
      expect(promptCalls).toEqual([
        "internal route A\n<!-- OMO_INTERNAL_INITIATOR -->",
        "internal route B\n<!-- OMO_INTERNAL_INITIATOR -->",
      ])
    } finally {
      Date.now = originalDateNow
    }
  })

  test("#given continuation prompts differ by route metadata #when the broad hold has expired #then semantic dedupe still coalesces intent-level duplicates", async () => {
    // given
    const promptCalls: string[] = []
    const originalDateNow = Date.now
    let currentNow = originalDateNow()
    Date.now = () => currentNow
    const sessionID = "ses_semantic_continuation_intent"
    const client = {
      session: {
        promptAsync: async () => {
          promptCalls.push("prompt")
        },
      },
    }

    try {
      // when
      const first = await dispatchInternalPrompt({
        mode: "async",
        client,
        sessionID,
        input: {
          path: { id: sessionID },
          body: {
            parts: [createInternalAgentContinuationTextPart("continue from route A")],
            agent: "sisyphus",
            model: "openai/gpt-5",
          },
          query: { directory: "/workspace/project", tools: ["task"], route: "todo-enforcer" },
        },
        source: "test:semantic-continuation:first",
        settleMs: 0,
        postDispatchHoldMs: 1,
      })
      currentNow += 2
      const second = await dispatchInternalPrompt({
        mode: "async",
        client,
        sessionID,
        input: {
          path: { id: sessionID },
          body: {
            parts: [createInternalAgentContinuationTextPart("continue from route B")],
            agent: "atlas",
            model: "anthropic/claude-sonnet",
          },
          query: { directory: "/workspace/project", tools: ["team_task_create"], route: "team-mailbox" },
        },
        source: "test:semantic-continuation:second",
        settleMs: 0,
        postDispatchHoldMs: 0,
      })

      // then
      expect(first.status).toBe("dispatched")
      expect(second).toEqual({
        status: "queued",
        queuedBy: "test:semantic-continuation:first",
        position: 0,
      })
      expect(promptCalls).toEqual(["prompt"])
    } finally {
      Date.now = originalDateNow
    }
  })
})
