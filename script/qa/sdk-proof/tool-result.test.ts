import { describe, expect, test } from "bun:test"

import { toolResultFor } from "./world/tool-result.ts"

// The tools column's correlation boundary: a step takes only the result answered to its own prompt (by the nonce the
// prompt carries), so a delayed result of an earlier call never stands in for it.

const resultRequest = (prompt: string, result: object) => ({
  messages: [{ role: "user", content: prompt }, { role: "assistant" }, { role: "tool" }],
  answer: { kind: "tool_result", tool: "thread_send", result: JSON.stringify({ details: { result } }) },
})

describe("which tool result answers a step", () => {
  test("#given an earlier call's result arriving after this step's prompt #when correlated #then it is not taken", () => {
    const late = resultRequest("QA:CALL thread_send e30\nx1a-call-earlier", { kind: "ok", turn: "earlier" })
    expect(toolResultFor([late], "thread_send", "x1a-call-this")).toBeUndefined()
  })

  test("#given this step's result among others #when correlated #then that one is taken", () => {
    const requests = [
      resultRequest("QA:CALL thread_send e30\nx1a-call-earlier", { kind: "ok", turn: "earlier" }),
      resultRequest("QA:CALL thread_send e30\nx1a-call-this", { kind: "ok", turn: "this" }),
    ]
    expect(toolResultFor(requests, "thread_send", "x1a-call-this")).toEqual({ kind: "ok", turn: "this" })
  })

  test("#given the result of another tool for this prompt #when correlated #then it is not taken", () => {
    expect(
      toolResultFor([resultRequest("x1a-call-this", { kind: "ok" })], "thread_read", "x1a-call-this"),
    ).toBeUndefined()
  })
})
