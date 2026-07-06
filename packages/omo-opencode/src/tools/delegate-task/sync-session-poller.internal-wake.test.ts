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

const internalAllCompleteWake = `<system-reminder>
[BACKGROUND TASK COMPLETED]
[ALL BACKGROUND TASKS COMPLETE]
</system-reminder>
<!-- OMO_INTERNAL_INITIATOR -->
<!-- OMO_INTERNAL_NOREPLY -->`

const markerCollisionText = `<system-reminder>
[BACKGROUND TASK COMPLETED]
[ALL BACKGROUND TASKS COMPLETE]
</system-reminder>
<!-- OMO_INTERNAL_INITIATOR -->`

function createClientForMessages(messages: unknown[]): OpencodeClient {
  return unsafeTestValue<OpencodeClient>({
    session: {
      messages: async () => ({ data: messages }),
      status: async () => ({ data: { ses_test: { type: "idle" } } }),
      abort: async () => ({ data: {} }),
    },
  })
}

describe("pollSyncSession internal all-complete wakes", () => {
  afterEach(() => {
    __resetTimingConfig()
  })

  test("#given terminal assistant turn followed by internal all-complete wake #when polling #then the sync task completes", async () => {
    // given
    __setTimingConfig({
      POLL_INTERVAL_MS: 1,
      MAX_POLL_TIME_MS: 50,
    })
    const client = createClientForMessages([
      { info: { id: "msg_001", role: "user", time: { created: 1000 } } },
      {
        info: { id: "msg_002", role: "assistant", time: { created: 2000 }, finish: "stop" },
        parts: [{ type: "text", text: "Done" }],
      },
      {
        info: { id: "msg_003", role: "user", time: { created: 3000 } },
        parts: [{ type: "text", text: internalAllCompleteWake }],
      },
    ])

    // when
    const result = await pollSyncSession(toolContext, client, {
      sessionID: "ses_test",
      agentToUse: "sisyphus",
      toastManager: null,
      taskId: undefined,
    }, 50)

    // then
    expect(result).toBeNull()
  })

  test("#given terminal assistant error followed by internal all-complete wake #when polling #then the error is returned", async () => {
    // given
    __setTimingConfig({
      POLL_INTERVAL_MS: 1,
      MAX_POLL_TIME_MS: 50,
    })
    const client = createClientForMessages([
      { info: { id: "msg_001", role: "user", time: { created: 1000 } } },
      {
        info: {
          id: "msg_002",
          role: "assistant",
          time: { created: 2000 },
          finish: "stop",
          error: { message: "child failed after stale output" },
        },
        parts: [{ type: "text", text: "old deliverable" }],
      },
      {
        info: { id: "msg_003", role: "user", time: { created: 3000 } },
        parts: [{ type: "text", text: internalAllCompleteWake }],
      },
    ])

    // when
    const result = await pollSyncSession(toolContext, client, {
      sessionID: "ses_test",
      agentToUse: "sisyphus",
      toastManager: null,
      taskId: undefined,
    }, 50)

    // then
    expect(result).toBe("child failed after stale output")
  })

  test("#given terminal assistant turn followed by ordinary user turn #when polling #then the sync task remains incomplete", async () => {
    // given
    __setTimingConfig({
      POLL_INTERVAL_MS: 1,
      MAX_POLL_TIME_MS: 50,
    })
    const client = createClientForMessages([
      { info: { id: "msg_001", role: "user", time: { created: 1000 } } },
      {
        info: { id: "msg_002", role: "assistant", time: { created: 2000 }, finish: "stop" },
        parts: [{ type: "text", text: "Done" }],
      },
      {
        info: { id: "msg_003", role: "user", time: { created: 3000 } },
        parts: [{ type: "text", text: "please continue" }],
      },
    ])

    // when
    const result = await pollSyncSession(toolContext, client, {
      sessionID: "ses_test",
      agentToUse: "sisyphus",
      toastManager: null,
      taskId: undefined,
    }, 50)

    // then
    expect(result).toBe("Poll inactivity timeout reached after 50ms without active OpenCode status for session ses_test")
  })

  test("#given user task text collides with internal markers before terminal assistant turn #when polling #then the sync task completes", async () => {
    // given
    __setTimingConfig({
      POLL_INTERVAL_MS: 1,
      MAX_POLL_TIME_MS: 50,
    })
    const client = createClientForMessages([
      {
        info: { id: "msg_001", role: "user", time: { created: 1000 } },
        parts: [{ type: "text", text: `Please explain ${markerCollisionText}` }],
      },
      {
        info: { id: "msg_002", role: "assistant", time: { created: 2000 }, finish: "stop" },
        parts: [{ type: "text", text: "Done" }],
      },
    ])

    // when
    const result = await pollSyncSession(toolContext, client, {
      sessionID: "ses_test",
      agentToUse: "sisyphus",
      toastManager: null,
      taskId: undefined,
    }, 50)

    // then
    expect(result).toBeNull()
  })

  test("#given latest user turn collides with internal markers but is not no-reply #when polling #then completion is not reported early", async () => {
    // given
    __setTimingConfig({
      POLL_INTERVAL_MS: 1,
      MAX_POLL_TIME_MS: 50,
    })
    const client = createClientForMessages([
      { info: { id: "msg_001", role: "user", time: { created: 1000 } } },
      {
        info: { id: "msg_002", role: "assistant", time: { created: 2000 }, finish: "stop" },
        parts: [{ type: "text", text: "Done" }],
      },
      {
        info: { id: "msg_003", role: "user", time: { created: 3000 } },
        parts: [{ type: "text", text: markerCollisionText }],
      },
    ])

    // when
    const result = await pollSyncSession(toolContext, client, {
      sessionID: "ses_test",
      agentToUse: "sisyphus",
      toastManager: null,
      taskId: undefined,
    }, 50)

    // then
    expect(result).toBe("Poll inactivity timeout reached after 50ms without active OpenCode status for session ses_test")
  })
})
