/// <reference types="bun-types" />
import { afterEach, describe, expect, test } from "bun:test"
import { unsafeTestValue } from "../../../../../test-support/unsafe-test-value"
import { pollSyncSession } from "./sync-session-poller"
import { __resetTimingConfig, __setTimingConfig } from "./timing"
import type { OpencodeClient, ToolContextWithMetadata } from "./types"

const toolContext: ToolContextWithMetadata = {
  sessionID: "ses_parent",
  messageID: "msg_parent",
  agent: "sisyphus",
  abort: new AbortController().signal,
}

describe("pollSyncSession status fallback", () => {
  afterEach(() => {
    __resetTimingConfig()
  })

  test("#given status API is unavailable but assistant text exists #when polling #then messages complete the sync task", async () => {
    // given
    __setTimingConfig({
      POLL_INTERVAL_MS: 1,
      MAX_POLL_TIME_MS: 50,
    })
    const client = unsafeTestValue<OpencodeClient>({
      session: {
        messages: async () => ({
          data: [
            {
              info: { role: "assistant" },
              parts: [{ type: "text", text: "done" }],
            },
          ],
        }),
        abort: async () => ({ data: {} }),
      },
    })

    // when
    const result = await pollSyncSession(toolContext, client, {
      sessionID: "ses_missing_status",
      agentToUse: "sisyphus",
      toastManager: null,
      taskId: undefined,
    }, 50)

    // then
    expect(result).toBeNull()
  })

  test("#given a long newest-first transcript and missing status #when polling #then the terminal child is handed back", async () => {
    // given: the original user turn is just outside the old fixed 100-message page
    __setTimingConfig({
      POLL_INTERVAL_MS: 1,
      MAX_POLL_TIME_MS: 50,
    })
    const messages = [
      {
        info: { id: "msg_000", role: "user", time: { created: 1_000 } },
      },
      ...Array.from({ length: 100 }, (_, index) => ({
        info: {
          id: `msg_${String(index + 1).padStart(3, "0")}`,
          role: "assistant",
          time: { created: 2_000 + index },
          finish: "tool-calls",
        },
        parts: [{ type: "tool-call", text: `tool call ${index + 1}` }],
      })),
      {
        info: { id: "msg_101", role: "assistant", time: { created: 3_000 }, finish: "stop" },
        parts: [{ type: "text", text: "Long child complete" }],
      },
    ]
    const newestFirst = [...messages].reverse()
    const messageQueries: Array<{ limit?: number } | undefined> = []
    const client = unsafeTestValue<OpencodeClient>({
      session: {
        messages: async (request: { query?: { limit?: number } }) => {
          const limit = request.query?.limit
          messageQueries.push(request.query)
          return { data: limit === undefined ? newestFirst : newestFirst.slice(0, limit) }
        },
        status: async () => ({ data: {} }),
        abort: async () => ({ data: {} }),
      },
    })

    // when
    const result = await pollSyncSession(toolContext, client, {
      sessionID: "ses_long_missing_status",
      agentToUse: "sisyphus",
      toastManager: null,
      taskId: undefined,
    }, 50)

    // then
    expect(result).toBeNull()
    expect(messageQueries[0]).toBeUndefined()
  })
})
