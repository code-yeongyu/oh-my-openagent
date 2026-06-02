/// <reference types="bun-types" />
import { afterEach, describe, expect, test } from "bun:test"
import { createSessionRecoveryHook } from "./hook"
import { releaseAllPromptAsyncReservationsForTesting } from "../../shared/prompt-async-gate"

type RecoverableInfo = Parameters<ReturnType<typeof createSessionRecoveryHook>["handleSessionRecovery"]>[0]

describe("session-recovery immutable thinking block errors", () => {
  afterEach(() => {
    releaseAllPromptAsyncReservationsForTesting()
  })

  test("#given Anthropic rejects modified latest assistant thinking blocks #when recovery handles the error #then it leaves the session history untouched", async () => {
    //#given
    const counts = {
      abort: 0,
      abortCallback: 0,
      messages: 0,
      promptAsync: 0,
      toast: 0,
    }
    const info: RecoverableInfo = {
      id: "msg_failed_modified_thinking",
      role: "assistant",
      sessionID: "ses_modified_thinking",
      error: {
        message:
          "messages.3.content.3: `thinking` or `redacted_thinking` blocks in the latest assistant message cannot be modified. These blocks must remain as they were in the original response.",
      },
    }
    const ctx = {
      client: {
        session: {
          abort: async () => {
            counts.abort++
            return {}
          },
          messages: async () => {
            counts.messages++
            return {
              data: [
                {
                  info: {
                    id: info.id,
                    role: "assistant",
                    error: info.error,
                  },
                  parts: [
                    {
                      id: "prt_reasoning",
                      type: "reasoning",
                      text: "signed reasoning text",
                      metadata: { anthropic: { signature: "sig_reasoning" } },
                    },
                    {
                      id: "prt_redacted",
                      type: "redacted_thinking",
                      signature: "sig_redacted",
                    },
                    {
                      id: "prt_text",
                      type: "text",
                      text: "assistant text",
                    },
                  ],
                },
              ],
            }
          },
          promptAsync: async () => {
            counts.promptAsync++
            return {}
          },
        },
        tui: {
          showToast: async () => {
            counts.toast++
            return {}
          },
        },
      },
      directory: "/tmp/session-recovery-modified-thinking-test",
    }
    const hook = createSessionRecoveryHook(ctx as never)
    hook.setOnAbortCallback(() => {
      counts.abortCallback++
    })

    //#when
    const result = await hook.handleSessionRecovery(info)

    //#then
    expect(result).toBe(false)
    expect(counts.toast).toBe(1)
    expect(counts.abortCallback).toBe(0)
    expect(counts.abort).toBe(0)
    expect(counts.messages).toBe(0)
    expect(counts.promptAsync).toBe(0)
  })
})
