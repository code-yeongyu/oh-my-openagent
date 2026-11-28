import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { __setTimingConfig, __resetTimingConfig } from "./timing"
import { pollSyncSession } from "./sync-session-poller"
import type { OpencodeClient } from "./types"

function busyChildClient(texts: ReadonlyArray<string | undefined>, aborts: string[]): OpencodeClient {
  let polls = 0
  const client = {
    session: {
      messages: async () => {
        polls = Math.min(polls + 1, texts.length)
        const data: unknown[] = [{ info: { id: "msg_user", role: "user", time: { created: 1 } } }]
        texts.slice(0, polls).forEach((text, index) => {
          data.push({
            info: { id: `msg_assistant_${index}`, role: "assistant", time: { created: 2 + index }, finish: "tool-calls" },
            parts: text === undefined ? [{ type: "tool", text: "" }] : [{ type: "reasoning", text: "private reasoning" }, { type: "text", text }],
          })
        })
        return { data }
      },
      status: async () => ({ data: { ses_child: { type: "busy" } } }),
      abort: async (input: { path: { id: string } }) => {
        aborts.push(input.path.id)
        return {}
      },
    },
  }
  return client as unknown as OpencodeClient
}

const ctx = { sessionID: "parent-session", messageID: "parent-message", agent: "test-agent", abort: new AbortController().signal }

describe("pollSyncSession max assistant turns (#9981)", () => {
  beforeEach(() => {
    __setTimingConfig({ POLL_INTERVAL_MS: 1, MIN_STABILITY_TIME_MS: 0, STABILITY_POLLS_REQUIRED: 1, MAX_POLL_TIME_MS: 5000 })
  })

  afterEach(() => {
    __resetTimingConfig()
  })

  test("#given a child that hits the turn cap #when the poller aborts it #then the result carries the child's latest assistant text", async () => {
    // given
    const aborts: string[] = []
    const client = busyChildClient(["PARTIAL: 1 of 3 parts", "PARTIAL: 2 of 3 parts", undefined], aborts)

    // when
    const result = await pollSyncSession(ctx, client, { sessionID: "ses_child", agentToUse: "explore", toastManager: null, taskId: undefined, maxAssistantTurns: 3 })

    // then
    expect(aborts).toEqual(["ses_child"])
    expect(result).toStartWith("Task aborted: subagent exceeded 3 assistant turns without completing.")
    expect(result).toContain("PARTIAL: 2 of 3 parts")
    expect(result).not.toContain("PARTIAL: 1 of 3 parts")
    expect(result).not.toContain("private reasoning")
  })

  test("#given a capped child that never wrote text #when the poller aborts it #then the result is the abort line alone", async () => {
    // given
    const aborts: string[] = []
    const client = busyChildClient([undefined, undefined], aborts)

    // when
    const result = await pollSyncSession(ctx, client, { sessionID: "ses_child", agentToUse: "explore", toastManager: null, taskId: undefined, maxAssistantTurns: 2 })

    // then
    expect(result).toBe("Task aborted: subagent exceeded 2 assistant turns without completing. This usually indicates an infinite tool-call loop. Session ID: ses_child")
  })
})
