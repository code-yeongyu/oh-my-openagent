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
})
