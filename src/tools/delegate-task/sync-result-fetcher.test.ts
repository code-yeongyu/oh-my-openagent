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
})