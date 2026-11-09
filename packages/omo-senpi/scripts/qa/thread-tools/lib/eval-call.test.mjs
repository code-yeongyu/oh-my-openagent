import { describe, expect, test } from "bun:test"

import { calledToolName, planModelToolCall } from "./eval-call.mjs"

describe("fake-model routing of a QA:CALL to an eval-only tool", () => {
  test("#given the engine advertises eval but not the tool #when the call is planned #then it becomes an eval cell that calls the tool and prints its text", () => {
    const planned = planModelToolCall({ name: "thread_send", args: { thread: "peer", message: "hi" } }, ["read", "eval", "thread_list_other"])

    expect(planned.name).toBe("eval")
    expect(planned.args.language).toBe("js")
    expect(typeof planned.args.summary).toBe("string")
    expect(planned.args.code).toContain('await tool.thread_send({"thread":"peer","message":"hi"})')
    expect(planned.args.code).toContain("print(outcome.text)")
    expect(calledToolName("eval", JSON.stringify(planned.args))).toBe("thread_send")
  })

  test("#given the engine advertises the tool directly #when the call is planned #then it stays a direct call", () => {
    const call = { name: "thread_send", args: { thread: "peer", message: "hi" } }

    expect(planModelToolCall(call, ["eval", "thread_send"])).toBe(call)
    expect(calledToolName("thread_send", JSON.stringify(call.args))).toBe("thread_send")
  })

  test("#given the engine advertises neither the tool nor eval #when the call is planned #then it stays direct so the engine's own refusal surfaces", () => {
    const call = { name: "thread_send", args: {} }

    expect(planModelToolCall(call, ["read", "bash"])).toBe(call)
  })

  test("#given an eval cell this harness did not emit #when its name is resolved #then it stays eval", () => {
    expect(calledToolName("eval", JSON.stringify({ language: "js", code: "print(1)" }))).toBe("eval")
    expect(calledToolName("eval", "not json")).toBe("eval")
    expect(calledToolName("eval", undefined)).toBe("eval")
  })
})
