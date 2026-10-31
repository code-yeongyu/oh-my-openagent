import { afterEach, describe, expect, mock, test } from "bun:test"
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

const LONG_POLL_TIMEOUT_MS = 60_000

const notFound = (sessionID: string) => ({
  data: undefined,
  error: { name: "NotFoundError", data: { message: `Session not found: ${sessionID}` } },
})

describe("pollSyncSession for a session that no longer exists", () => {
  afterEach(() => {
    __resetTimingConfig()
  })

  test("#given the session is absent from status and deleted #when polling #then it stops with a terminal error instead of waiting for the timeout", async () => {
    // given
    __setTimingConfig({ POLL_INTERVAL_MS: 1 })
    const abort = mock(async () => ({}))
    const client = unsafeTestValue<OpencodeClient>({
      session: {
        status: async () => ({ data: {} }),
        get: async (input: { path: { id: string } }) => notFound(input.path.id),
        messages: async (input: { path: { id: string } }) => notFound(input.path.id),
        abort,
      },
    })

    // when
    const result = await pollSyncSession(toolContext, client, {
      sessionID: "ses_deleted",
      agentToUse: "oracle",
      toastManager: null,
      taskId: undefined,
      anchorMessageCount: 0,
    }, LONG_POLL_TIMEOUT_MS)

    // then
    expect(result).not.toBeNull()
    expect(result?.startsWith("Error:")).toBe(true)
    expect(result).toContain("ses_deleted")
    expect(result).toContain("no longer exists")
    expect(result).not.toContain("Poll inactivity timeout")
  }, 5_000)

  test("#given an idle session that still exists outside the status map #when polling #then completion is still detected", async () => {
    // given
    __setTimingConfig({ POLL_INTERVAL_MS: 1 })
    const client = unsafeTestValue<OpencodeClient>({
      session: {
        status: async () => ({ data: {} }),
        get: async (input: { path: { id: string } }) => ({ data: { id: input.path.id } }),
        messages: async () => ({
          data: [
            { info: { id: "msg_001", role: "user" }, parts: [{ type: "text", text: "go" }] },
            { info: { id: "msg_002", role: "assistant", finish: "stop" }, parts: [{ type: "text", text: "done" }] },
          ],
        }),
        abort: async () => ({}),
      },
    })

    // when
    const result = await pollSyncSession(toolContext, client, {
      sessionID: "ses_idle",
      agentToUse: "oracle",
      toastManager: null,
      taskId: undefined,
    }, LONG_POLL_TIMEOUT_MS)

    // then
    expect(result).toBeNull()
  }, 5_000)
})
