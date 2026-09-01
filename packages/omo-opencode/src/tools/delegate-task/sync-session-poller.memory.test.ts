import { afterEach, describe, expect, test } from "bun:test"
import { unsafeTestValue } from "../../../../../test-support/unsafe-test-value"
import { pollSyncSession } from "./sync-session-poller"
import { __resetTimingConfig, __setTimingConfig } from "./timing"
import type { OpencodeClient, ToolContextWithMetadata } from "./types"

const ctx = unsafeTestValue<ToolContextWithMetadata>({
  sessionID: "parent",
  messageID: "parent-message",
  agent: "sisyphus",
  abort: new AbortController().signal,
})

describe("pollSyncSession transcript retention", () => {
  afterEach(__resetTimingConfig)

  test("fetches the full transcript once while idle status remains unchanged", async () => {
    __setTimingConfig({ POLL_INTERVAL_MS: 1, MAX_POLL_TIME_MS: 15 })
    let messagesCalls = 0
    let statusCalls = 0
    const client = unsafeTestValue<OpencodeClient>({
      session: {
        status: async () => {
          statusCalls += 1
          return { data: { child: { type: "idle" } } }
        },
        messages: async () => {
          messagesCalls += 1
          return { data: [{ info: { role: "user", id: "u1" }, parts: [{ type: "text", text: "work" }] }] }
        },
        abort: async () => ({ data: true }),
      },
    })

    const result = await pollSyncSession(ctx, client, {
      sessionID: "child",
      agentToUse: "explore",
      toastManager: null,
      taskId: undefined,
    }, 15)

    expect(result).toContain("Poll inactivity timeout reached")
    expect(messagesCalls).toBeGreaterThanOrEqual(1)
    expect(messagesCalls).toBeLessThan(statusCalls)
  })
})
