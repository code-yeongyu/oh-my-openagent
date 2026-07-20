const { describe, test, expect } = require("bun:test")

describe("fetchSyncResult", () => {
  test("without anchor: returns latest assistant message (existing behavior)", async () => {
    //#given - messages with multiple assistant responses, no anchor
    const { fetchSyncResult } = require("./sync-result-fetcher")

    const mockClient = {
      session: {
        messages: async () => ({
          data: [
            { info: { id: "msg_001", role: "user", time: { created: 1000 } } },
            {
              info: { id: "msg_002", role: "assistant", time: { created: 2000 } },
              parts: [{ type: "text", text: "First response" }],
            },
            { info: { id: "msg_003", role: "user", time: { created: 3000 } } },
            {
              info: { id: "msg_004", role: "assistant", time: { created: 4000 } },
              parts: [{ type: "text", text: "Latest response" }],
            },
          ],
        }),
      },
    }

    //#when
    const result = await fetchSyncResult(mockClient, "ses_test")

    //#then - should return the latest assistant message
    expect(result).toEqual({ ok: true, textContent: "Latest response" })
  })

  test("with anchor: returns only assistant messages from after anchor point", async () => {
    //#given - messages with anchor at index 2 (after first assistant), should return second assistant
    const { fetchSyncResult } = require("./sync-result-fetcher")

    const mockClient = {
      session: {
        messages: async () => ({
          data: [
            { info: { id: "msg_001", role: "user", time: { created: 1000 } } },
            {
              info: { id: "msg_002", role: "assistant", time: { created: 2000 } },
              parts: [{ type: "text", text: "First response" }],
            },
            { info: { id: "msg_003", role: "user", time: { created: 3000 } } },
            {
              info: { id: "msg_004", role: "assistant", time: { created: 4000 } },
              parts: [{ type: "text", text: "After anchor response" }],
            },
          ],
        }),
      },
    }

    //#when - anchor at 2 (after first assistant message)
    const result = await fetchSyncResult(mockClient, "ses_test", 2)

    //#then - should return assistant message after anchor
    expect(result).toEqual({ ok: true, textContent: "After anchor response" })
  })

  test("with anchor + no new messages: returns explicit error", async () => {
    //#given - anchor beyond available messages, no assistant after anchor
    const { fetchSyncResult } = require("./sync-result-fetcher")

    const mockClient = {
      session: {
        messages: async () => ({
          data: [
            { info: { id: "msg_001", role: "user", time: { created: 1000 } } },
            {
              info: { id: "msg_002", role: "assistant", time: { created: 2000 } },
              parts: [{ type: "text", text: "Response" }],
            },
          ],
        }),
      },
    }

    //#when - anchor at 2 (beyond messages)
    const result = await fetchSyncResult(mockClient, "ses_test", 2)

    //#then - should return error about no new response
    expect(result.ok).toBe(false)
    expect(result.error).toContain("no new response was generated")
  })

  test("with anchor + new assistant but non-terminal: returns latest terminal assistant", async () => {
    //#given - anchor before multiple assistant messages, should return latest
    const { fetchSyncResult } = require("./sync-result-fetcher")

    const mockClient = {
      session: {
        messages: async () => ({
          data: [
            { info: { id: "msg_001", role: "user", time: { created: 1000 } } },
            {
              info: { id: "msg_002", role: "assistant", time: { created: 2000 } },
              parts: [{ type: "text", text: "First response" }],
            },
            { info: { id: "msg_003", role: "user", time: { created: 3000 } } },
            {
              info: { id: "msg_004", role: "assistant", time: { created: 3500 } },
              parts: [{ type: "text", text: "Middle response" }],
            },
            { info: { id: "msg_005", role: "user", time: { created: 4000 } } },
            {
              info: { id: "msg_006", role: "assistant", time: { created: 4500 } },
              parts: [{ type: "text", text: "Latest response" }],
            },
          ],
        }),
      },
    }

    //#when - anchor at 2 (after first assistant)
    const result = await fetchSyncResult(mockClient, "ses_test", 2)

    //#then - should return the latest assistant message after anchor
    expect(result).toEqual({ ok: true, textContent: "Latest response" })
  })

  test("empty messages array: returns error", async () => {
    //#given - empty messages array
    const { fetchSyncResult } = require("./sync-result-fetcher")

    const mockClient = {
      session: {
        messages: async () => ({
          data: [],
        }),
      },
    }

    //#when
    const result = await fetchSyncResult(mockClient, "ses_test")

    //#then - should return error about no assistant response
    expect(result.ok).toBe(false)
    expect(result.error).toContain("No assistant response found")
  })

  test("strict abort recovery: does not fall back to older text when latest assistant is error", async () => {
    //#given
    const { fetchSyncResult } = require("./sync-result-fetcher")

    const mockClient = {
      session: {
        messages: async () => ({
          data: [
            { info: { id: "msg_001", role: "user", time: { created: 1000 } } },
            {
              info: { id: "msg_002", role: "assistant", time: { created: 2000 } },
              parts: [{ type: "text", text: "Older text" }],
            },
            {
              info: {
                id: "msg_003",
                role: "assistant",
                time: { created: 3000 },
                error: { name: "MessageAbortedError", message: "The operation was aborted." },
              },
              parts: [],
            },
          ],
        }),
      },
    }

    //#when
    const result = await fetchSyncResult(mockClient, "ses_test", 1, { strictAbortRecovery: true })

    //#then
    expect(result.ok).toBe(false)
    expect(result.error).toContain("Latest assistant message is an error")
  })

  test("deliverableTag: returns tagged turn even when a newer untagged turn exists", async () => {
    //#given - the doc's failure sequence: plan written in an earlier turn, then a
    // brief notification-triggered follow-up that does NOT carry the envelope.
    const { fetchSyncResult } = require("./sync-result-fetcher")

    const mockClient = {
      session: {
        messages: async () => ({
          data: [
            { info: { id: "msg_001", role: "user", time: { created: 1000 } } },
            {
              info: { id: "msg_002", role: "assistant", time: { created: 2000 } },
              parts: [{ type: "text", text: "<plan>\n# Real Plan\nfull content\n</plan>" }],
            },
            { info: { id: "msg_003", role: "user", time: { created: 3000 } } },
            {
              info: { id: "msg_004", role: "assistant", time: { created: 4000 } },
              parts: [{ type: "text", text: "Results confirm the plan." }],
            },
          ],
        }),
      },
    }

    //#when
    const result = await fetchSyncResult(mockClient, "ses_test", undefined, { deliverableTag: "plan" })

    //#then - returns the envelope contents, not the newer untagged follow-up
    expect(result).toEqual({ ok: true, textContent: "# Real Plan\nfull content" })
  })

  test("deliverableTag: prefers the newest tagged turn when multiple envelopes exist", async () => {
    //#given - a refined plan emitted after results supersedes an earlier draft
    const { fetchSyncResult } = require("./sync-result-fetcher")

    const mockClient = {
      session: {
        messages: async () => ({
          data: [
            { info: { id: "msg_001", role: "user", time: { created: 1000 } } },
            {
              info: { id: "msg_002", role: "assistant", time: { created: 2000 } },
              parts: [{ type: "text", text: "<plan>draft</plan>" }],
            },
            { info: { id: "msg_003", role: "user", time: { created: 3000 } } },
            {
              info: { id: "msg_004", role: "assistant", time: { created: 4000 } },
              parts: [{ type: "text", text: "<plan>refined</plan>" }],
            },
          ],
        }),
      },
    }

    //#when
    const result = await fetchSyncResult(mockClient, "ses_test", undefined, { deliverableTag: "plan" })

    //#then
    expect(result).toEqual({ ok: true, textContent: "refined" })
  })

  test("deliverableTag: falls back to recency when no closed envelope is present", async () => {
    //#given - the model never emitted a complete <plan> block
    const { fetchSyncResult } = require("./sync-result-fetcher")

    const mockClient = {
      session: {
        messages: async () => ({
          data: [
            { info: { id: "msg_001", role: "user", time: { created: 1000 } } },
            {
              info: { id: "msg_002", role: "assistant", time: { created: 2000 } },
              parts: [{ type: "text", text: "First response" }],
            },
            { info: { id: "msg_003", role: "user", time: { created: 3000 } } },
            {
              info: { id: "msg_004", role: "assistant", time: { created: 4000 } },
              parts: [{ type: "text", text: "Latest response" }],
            },
          ],
        }),
      },
    }

    //#when
    const result = await fetchSyncResult(mockClient, "ses_test", undefined, { deliverableTag: "plan" })

    //#then - unchanged behavior: newest assistant text
    expect(result).toEqual({ ok: true, textContent: "Latest response" })
  })

  test("deliverableTag: an unclosed envelope does not match and falls back", async () => {
    //#given - streaming cut off before the closing tag
    const { fetchSyncResult } = require("./sync-result-fetcher")

    const mockClient = {
      session: {
        messages: async () => ({
          data: [
            { info: { id: "msg_001", role: "user", time: { created: 1000 } } },
            {
              info: { id: "msg_002", role: "assistant", time: { created: 2000 } },
              parts: [{ type: "text", text: "<plan>\n# Truncated plan with no closing tag" }],
            },
          ],
        }),
      },
    }

    //#when
    const result = await fetchSyncResult(mockClient, "ses_test", undefined, { deliverableTag: "plan" })

    //#then - falls back to returning the assistant text as-is
    expect(result).toEqual({ ok: true, textContent: "<plan>\n# Truncated plan with no closing tag" })
  })

  test("strict abort recovery: requires latest assistant text output", async () => {
    //#given
    const { fetchSyncResult } = require("./sync-result-fetcher")

    const mockClient = {
      session: {
        messages: async () => ({
          data: [
            { info: { id: "msg_001", role: "user", time: { created: 1000 } } },
            {
              info: { id: "msg_002", role: "assistant", time: { created: 2000 } },
              parts: [{ type: "tool", toolCallId: "t1", toolName: "x", state: "output-available", input: {}, output: {} }],
            },
          ],
        }),
      },
    }

    //#when
    const result = await fetchSyncResult(mockClient, "ses_test", 0, { strictAbortRecovery: true })

    //#then
    expect(result.ok).toBe(false)
    expect(result.error).toContain("No assistant text output found in latest response")
  })

  test("strict abort recovery: does not salvage an older envelope when latest assistant is error", async () => {
    //#given - an earlier turn carries a complete <plan>, but the latest turn aborted.
    // The abort guard must take precedence over tagged extraction.
    const { fetchSyncResult } = require("./sync-result-fetcher")

    const mockClient = {
      session: {
        messages: async () => ({
          data: [
            { info: { id: "msg_001", role: "user", time: { created: 1000 } } },
            {
              info: { id: "msg_002", role: "assistant", time: { created: 2000 } },
              parts: [{ type: "text", text: "<plan>\n# Stale draft plan\n</plan>" }],
            },
            { info: { id: "msg_003", role: "user", time: { created: 3000 } } },
            {
              info: {
                id: "msg_004",
                role: "assistant",
                time: { created: 4000 },
                error: { name: "MessageAbortedError", message: "The operation was aborted." },
              },
              parts: [],
            },
          ],
        }),
      },
    }

    //#when - both strictAbortRecovery and deliverableTag are passed, as the real callers do
    const result = await fetchSyncResult(mockClient, "ses_test", 1, {
      strictAbortRecovery: true,
      deliverableTag: "plan",
    })

    //#then - the abort is reported, not the stale envelope
    expect(result.ok).toBe(false)
    expect(result.error).toContain("Latest assistant message is an error")
  })

  test("strict abort recovery: prefers the envelope when the latest message is clean", async () => {
    //#given - latest message is clean and carries a complete envelope
    const { fetchSyncResult } = require("./sync-result-fetcher")

    const mockClient = {
      session: {
        messages: async () => ({
          data: [
            { info: { id: "msg_001", role: "user", time: { created: 1000 } } },
            {
              info: { id: "msg_002", role: "assistant", time: { created: 2000 } },
              parts: [{ type: "text", text: "<plan>\n# Recovered plan\n</plan>" }],
            },
          ],
        }),
      },
    }

    //#when
    const result = await fetchSyncResult(mockClient, "ses_test", 1, {
      strictAbortRecovery: true,
      deliverableTag: "plan",
    })

    //#then - returns the envelope contents
    expect(result).toEqual({ ok: true, textContent: "# Recovered plan" })
  })

  test("deliverableTag: selects the last complete envelope within a single message", async () => {
    //#given - one message concatenates a reasoning-part draft envelope and a
    // text-part final envelope. A greedy capture would span both and leak tags;
    // the last complete block must win.
    const { fetchSyncResult } = require("./sync-result-fetcher")

    const mockClient = {
      session: {
        messages: async () => ({
          data: [
            { info: { id: "msg_001", role: "user", time: { created: 1000 } } },
            {
              info: { id: "msg_002", role: "assistant", time: { created: 2000 } },
              parts: [
                { type: "reasoning", text: "<plan>draft sketch</plan>" },
                { type: "text", text: "<plan>final plan</plan>" },
              ],
            },
          ],
        }),
      },
    }

    //#when
    const result = await fetchSyncResult(mockClient, "ses_test", undefined, { deliverableTag: "plan" })

    //#then - only the final block, with no embedded tags or draft content
    expect(result).toEqual({ ok: true, textContent: "final plan" })
  })

  test("deliverableTag: ignores a complete envelope in reasoning when final text is untagged", async () => {
    //#given - the model sketched a complete <plan> in its reasoning, but the final
    // text response carries no envelope. Envelope selection must look at final text
    // only, so this falls back to recency rather than returning the reasoning draft.
    const { fetchSyncResult } = require("./sync-result-fetcher")

    const mockClient = {
      session: {
        messages: async () => ({
          data: [
            { info: { id: "msg_001", role: "user", time: { created: 1000 } } },
            {
              info: { id: "msg_002", role: "assistant", time: { created: 2000 } },
              parts: [
                { type: "reasoning", text: "<plan>internal draft sketch</plan>" },
                { type: "text", text: "Final answer without a tag" },
              ],
            },
          ],
        }),
      },
    }

    //#when
    const result = await fetchSyncResult(mockClient, "ses_test", undefined, { deliverableTag: "plan" })

    //#then - falls back to the real response instead of the reasoning-only draft
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.textContent).toContain("Final answer without a tag")
      expect(result.textContent).not.toBe("internal draft sketch")
    }
  })

  test("truncates oversized sync result to the maxTokens budget", async () => {
    //#given - a subagent deliverable far larger than the budget
    const { fetchSyncResult } = require("./sync-result-fetcher")

    const oversized = `${"x".repeat(100_000)}`
    const mockClient = {
      session: {
        messages: async () => ({
          data: [
            { info: { id: "msg_001", role: "user", time: { created: 1000 } } },
            {
              info: { id: "msg_002", role: "assistant", time: { created: 2000 } },
              parts: [{ type: "text", text: oversized }],
            },
          ],
        }),
      },
    }

    //#when - budget of 10 tokens (40 chars at 4 chars/token)
    const result = await fetchSyncResult(mockClient, "ses_test", undefined, { maxTokens: 10 })

    //#then - the returned content is capped and flagged as truncated
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.textContent.length).toBeLessThan(oversized.length)
      expect(result.textContent).toContain("[TRUNCATED]")
    }
  })

  test("leaves small sync results untouched", async () => {
    //#given - a normal-sized deliverable well under the default budget
    const { fetchSyncResult } = require("./sync-result-fetcher")

    const mockClient = {
      session: {
        messages: async () => ({
          data: [
            { info: { id: "msg_001", role: "user", time: { created: 1000 } } },
            {
              info: { id: "msg_002", role: "assistant", time: { created: 2000 } },
              parts: [{ type: "text", text: "Short deliverable." }],
            },
          ],
        }),
      },
    }

    //#when
    const result = await fetchSyncResult(mockClient, "ses_test")

    //#then - no truncation marker, content preserved verbatim
    expect(result).toEqual({ ok: true, textContent: "Short deliverable." })
  })
})
