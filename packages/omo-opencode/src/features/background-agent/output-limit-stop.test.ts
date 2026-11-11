/// <reference types="bun-types" />

import { describe, expect, test } from "bun:test"
import {
  AssistantTurnFinishTracker,
  formatOutputLimitError,
  formatOutputLimitNote,
  getLatestAssistantTurn,
  getOutputLimitStop,
} from "./output-limit-stop"

const LENGTH_TURN = {
  info: {
    role: "assistant",
    finish: "length",
    tokens: { input: 1000, output: 32000, reasoning: 0 },
  },
  parts: [
    { type: "step-start" },
    { type: "step-finish", reason: "length", tokens: { output: 32000 } },
    { type: "patch" },
  ],
}

describe("getOutputLimitStop", () => {
  test("#given the latest assistant turn finished at the output cap with no text or tool part #when read #then it reports the token count and no result", () => {
    // given
    const messages = [
      { info: { role: "user" }, parts: [{ type: "text", text: "rewrite the file" }] },
      { info: { role: "assistant", finish: "stop" }, parts: [{ type: "tool" }, { type: "text", text: "read the file" }] },
      LENGTH_TURN,
    ]

    // when
    const result = getOutputLimitStop(messages)

    // then
    expect(result).toEqual({ messageID: undefined, outputTokens: 32000, hasResult: false })
    expect(result && formatOutputLimitError(result)).toBe("stopped at output limit (32000 tokens), no result")
  })

  test("#given finish is absent and the last step-finish reason is length #when read #then it still reports the stop", () => {
    // given
    const messages = [{
      info: { role: "assistant", tokens: { output: 32000 } },
      parts: [{ type: "step-finish", reason: "length" }],
    }]

    // when
    const result = getOutputLimitStop(messages)

    // then
    expect(result).toEqual({ messageID: undefined, outputTokens: 32000, hasResult: false })
  })

  test("#given the capped turn still delivered text #when read #then the stop omits the no-result clause", () => {
    // given
    const messages = [{
      info: { role: "assistant", finish: "length" },
      parts: [{ type: "text", text: "partial summary" }],
    }]

    // when
    const result = getOutputLimitStop(messages)

    // then
    expect(result?.hasResult).toBe(true)
    expect(result && formatOutputLimitNote(result)).toBe("output was cut at the output limit")
  })

  test("#given the capped turn only produced reasoning #when read #then it has no result", () => {
    // given
    const messages = [{
      info: { role: "assistant", finish: "length", tokens: { output: 32000 } },
      parts: [{ type: "reasoning", text: "thinking about the rewrite" }],
    }]

    // when
    const result = getOutputLimitStop(messages)

    // then
    expect(result?.hasResult).toBe(false)
  })

  test("#given a later assistant turn finished normally #when read #then an earlier length stop is ignored", () => {
    // given
    const messages = [
      LENGTH_TURN,
      { info: { role: "assistant", finish: "stop" }, parts: [{ type: "text", text: "done" }] },
    ]

    // when
    const result = getOutputLimitStop(messages)

    // then
    expect(result).toBeUndefined()
  })

  test("#given the latest message is not an assistant turn #when read #then the session is not stopped", () => {
    // given
    const messages = [LENGTH_TURN, { info: { role: "user" }, parts: [{ type: "text", text: "continue" }] }]

    // when
    const result = getOutputLimitStop(messages)

    // then
    expect(result).toBeUndefined()
  })

  test("#given the message finish is stop even if a step says length #when read #then the session is not stopped", () => {
    // given
    const messages = [{
      info: { role: "assistant", finish: "stop", tokens: { output: 20 } },
      parts: [{ type: "step-finish", reason: "length" }, { type: "text", text: "done" }],
    }]

    // when
    const result = getOutputLimitStop(messages)

    // then
    expect(result).toBeUndefined()
  })

  test("#given the latest assistant turn has an id #when its finish is read #then the turn records whether it hit the cap", () => {
    // given
    const messages = [{ info: { id: "msg_1", role: "assistant", finish: "length" }, parts: [] }]

    // when
    const turn = getLatestAssistantTurn(messages)

    // then
    expect(turn).toEqual({ messageID: "msg_1", stoppedOnLength: true })
  })
})

describe("AssistantTurnFinishTracker", () => {
  test("#given a capped turn #when a newer assistant turn starts #then the old stop is replaced", () => {
    // given
    const tracker = new AssistantTurnFinishTracker()
    tracker.recordMessageUpdated("ses", { id: "msg_1", role: "assistant", finish: "length" })

    // when
    tracker.recordMessageUpdated("ses", { id: "msg_2", role: "assistant" })

    // then
    expect(tracker.get("ses")).toEqual({ messageID: "msg_2", stoppedOnLength: false })
  })

  test("#given a capped turn #when the same message updates without a finish #then the stop is kept", () => {
    // given
    const tracker = new AssistantTurnFinishTracker()
    tracker.recordMessageUpdated("ses", { id: "msg_1", role: "assistant", finish: "length" })

    // when
    tracker.recordMessageUpdated("ses", { id: "msg_1", role: "assistant" })

    // then
    expect(tracker.get("ses")?.stoppedOnLength).toBe(true)
  })
})
