import { afterEach, describe, expect, test } from "bun:test"

import {
  dispatchInternalPrompt,
  releaseAllPromptAsyncReservationsForTesting,
} from "./prompt-async-gate"

describe("dispatchInternalPrompt question tool gating", () => {
  afterEach(() => {
    releaseAllPromptAsyncReservationsForTesting()
  })

  test("#given completed assistant question has no real user answer #when an internal promptAsync is requested #then no prompt is sent", async () => {
    // given
    let promptCalls = 0
    const client = {
      session: {
        status: async () => ({ data: { ses_completed_question: { type: "idle" } } }),
        messages: async () => ({
          data: [
            {
              info: {
                id: "msg_assistant",
                role: "assistant",
                finish: "tool-calls",
                time: { completed: 1_762_000_000_000 },
              },
              parts: [{ type: "tool", tool: "question", state: { status: "error" } }],
            },
          ],
        }),
        promptAsync: async () => {
          promptCalls += 1
        },
      },
    }

    // when
    const result = await dispatchInternalPrompt({
      mode: "async",
      client,
      sessionID: "ses_completed_question",
      input: { path: { id: "ses_completed_question" }, body: { parts: [] } },
      source: "test:completed-question",
      settleMs: 0,
      postDispatchHoldMs: 0,
    })

    // then
    expect(result.status).toBe("queued")
    expect(promptCalls).toBe(0)
  })
})
