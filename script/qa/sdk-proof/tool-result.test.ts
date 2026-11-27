import { describe, expect, test } from "bun:test"

import { toolResultFor } from "./world/tool-result.ts"

// The tools column's correlation boundary: a result is taken only through the call id it carries itself, back to the
// call made in answer to this step's prompt (which carries the step's nonce).

const call = (id: string, name = "thread_send") => ({ id, type: "function", function: { name, arguments: "{}" } })
const exchange = (prompt: string, id: string, result: object, name = "thread_send") => [
  { role: "user", content: prompt },
  { role: "assistant", tool_calls: [call(id, name)] },
  { role: "tool", tool_call_id: id, content: JSON.stringify({ details: { result } }) },
]

describe("which tool result answers a step", () => {
  test("#given this step's call and its result #when correlated #then that result is taken", () => {
    const requests = [
      { messages: exchange("QA:CALL thread_send e30\nx1a-call-this", "call_a", { kind: "ok", turn: "this" }) },
    ]
    expect(toolResultFor(requests, "thread_send", "x1a-call-this")).toEqual({ kind: "ok", turn: "this" })
  })

  test("#given an earlier call's result arriving after this step's prompt #when correlated #then it is not taken", () => {
    const late = [
      { role: "user", content: "QA:CALL thread_send e30\nx1a-call-earlier" },
      { role: "assistant", tool_calls: [call("call_old")] },
      { role: "user", content: "QA:CALL thread_send e30\nx1a-call-this" },
      { role: "tool", tool_call_id: "call_old", content: JSON.stringify({ details: { result: { kind: "ok" } } }) },
    ]
    expect(toolResultFor([{ messages: late }], "thread_send", "x1a-call-this")).toBeUndefined()
  })

  test("#given a result whose call id names no call #when correlated #then it is not taken", () => {
    const orphan = [
      { role: "user", content: "x1a-call-this" },
      { role: "tool", tool_call_id: "call_none", content: JSON.stringify({ kind: "ok" }) },
    ]
    expect(toolResultFor([{ messages: orphan }], "thread_send", "x1a-call-this")).toBeUndefined()
  })

  test("#given the result of another tool for this prompt #when correlated #then it is not taken", () => {
    const requests = [{ messages: exchange("x1a-call-this", "call_b", { kind: "ok" }, "thread_read") }]
    expect(toolResultFor(requests, "thread_send", "x1a-call-this")).toBeUndefined()
  })
})
