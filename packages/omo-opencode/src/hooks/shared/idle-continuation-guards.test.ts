import { describe, expect, test } from "bun:test"
import { ABORT_WINDOW_MS } from "../todo-continuation-enforcer/constants"
import {
  extractSessionErrorInfo,
  getAbortWindowElapsedMs,
  getTranscriptContinuationSkipReason,
  isAbortSessionErrorName,
} from "./idle-continuation-guards"

const userMessage = {
  info: { id: "msg_u", role: "user", time: { created: 0 } },
  parts: [{ type: "text", text: "Ship it" }],
}

describe("idle continuation guards", () => {
  test("#given no abort timestamp #when the window is checked #then it does not skip", () => {
    // given
    const abortDetectedAt = undefined

    // when
    const elapsed = getAbortWindowElapsedMs(abortDetectedAt, 5_000)

    // then
    expect(elapsed).toBeUndefined()
  })

  test("#given an abort inside the window #when the window is checked #then it returns the elapsed time", () => {
    // given
    const now = 10_000

    // when
    const elapsed = getAbortWindowElapsedMs(now - (ABORT_WINDOW_MS - 1), now)

    // then
    expect(elapsed).toBe(ABORT_WINDOW_MS - 1)
  })

  test("#given an abort exactly at the window boundary #when the window is checked #then it does not skip", () => {
    // given
    const now = 10_000

    // when
    const elapsed = getAbortWindowElapsedMs(now - ABORT_WINDOW_MS, now)

    // then
    expect(elapsed).toBeUndefined()
  })

  test("#given a completed assistant turn #when the transcript is checked #then there is no skip reason", () => {
    // given
    const messages = [
      userMessage,
      {
        info: { id: "msg_a", role: "assistant", finish: "stop", time: { created: 1, completed: 2 } },
        parts: [{ type: "text", text: "Done" }],
      },
    ]

    // when
    const reason = getTranscriptContinuationSkipReason(messages)

    // then
    expect(reason).toBeUndefined()
  })

  test("#given an aborted last assistant message #when the transcript is checked #then the reason is last-assistant-aborted", () => {
    // given
    const messages = [
      userMessage,
      {
        info: {
          id: "msg_a",
          role: "assistant",
          time: { created: 1, completed: 2 },
          error: { name: "AbortError" },
        },
        parts: [{ type: "text", text: "Partial" }],
      },
    ]

    // when
    const reason = getTranscriptContinuationSkipReason(messages)

    // then
    expect(reason).toBe("last-assistant-aborted")
  })

  test("#given an unanswered question #when the transcript is checked #then the reason is pending-question", () => {
    // given
    const messages = [
      userMessage,
      {
        info: { id: "msg_a", role: "assistant", finish: "tool-calls", time: { created: 1 } },
        parts: [{ type: "tool", tool: "question", state: { status: "running" } }],
      },
    ]

    // when
    const reason = getTranscriptContinuationSkipReason(messages)

    // then
    expect(reason).toBe("pending-question")
  })

  test("#given an unresolved non-question tool #when the transcript is checked #then the reason is pending-internal-response", () => {
    // given
    const messages = [
      userMessage,
      {
        info: { id: "msg_a", role: "assistant", finish: "tool-calls", time: { created: 1 } },
        parts: [{ type: "tool", tool: "read", state: { status: "running" } }],
      },
    ]

    // when
    const reason = getTranscriptContinuationSkipReason(messages)

    // then
    expect(reason).toBe("pending-internal-response")
  })

  test("#given a nested session error #when it is extracted #then the abort name is recognized", () => {
    // given
    const error = { data: { name: "MessageAbortedError", message: "aborted" } }

    // when
    const info = extractSessionErrorInfo(error)

    // then
    expect(info).toEqual({ name: "MessageAbortedError", message: "aborted" })
    expect(isAbortSessionErrorName(info?.name)).toBe(true)
    expect(isAbortSessionErrorName("APIError")).toBe(false)
  })
})
