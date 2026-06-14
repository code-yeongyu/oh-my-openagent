/// <reference types="bun-types" />
import { afterEach, describe, expect, test } from "bun:test"
import { unsafeTestValue } from "../../../../../test-support/unsafe-test-value"
import { pollSyncSession } from "./sync-session-poller"
import { __resetTimingConfig, __setTimingConfig } from "./timing"
import type { OpencodeClient, ToolContextWithMetadata } from "./types"

async function withMockedDateNow(stepMs: number, run: () => Promise<void>) {
  const originalDateNow = Date.now
  let now = 0
  Date.now = () => {
    const current = now
    now += stepMs
    return current
  }
  try {
    await run()
  } finally {
    Date.now = originalDateNow
  }
}

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

  test("#given status remains running but assistant text exists #when polling #then messages complete the sync task", async () => {
    // given
    __setTimingConfig({
      POLL_INTERVAL_MS: 1,
      MAX_POLL_TIME_MS: 50,
    })
    let messageCallCount = 0
    const client = unsafeTestValue<OpencodeClient>({
      session: {
        status: async () => ({ data: { ses_stale_running: { type: "running" } } }),
        messages: async () => {
          messageCallCount++
          return {
            data: [
              { info: { id: "msg_001", role: "user", time: { created: 1 } } },
              {
                info: { id: "msg_002", role: "assistant", time: { created: 2 } },
                parts: [{ type: "text", text: "done" }],
              },
            ],
          }
        },
        abort: async () => ({ data: {} }),
      },
    })

    await withMockedDateNow(6_000, async () => {
      // when
      const result = await pollSyncSession(toolContext, client, {
        sessionID: "ses_stale_running",
        agentToUse: "explore",
        toastManager: null,
        taskId: undefined,
      }, 30_000)

      // then
      expect(result).toBeNull()
      expect(messageCallCount).toBeGreaterThan(0)
    })
  })

})
