import { describe, expect, test } from "bun:test"
import { isExplicitUserAbortSignal } from "./model-abort-signal"

describe("isExplicitUserAbortSignal (issue #6424)", () => {
  test("detects explicit user abort or cancellation messages", () => {
    //#given
    const cases = [
      { message: "The user aborted this request.", expected: true },
      { message: "aborted by user", expected: true },
      { message: "Request was aborted.", expected: true },
      { message: "The operation was aborted.", expected: true },
      { message: "User cancelled the task", expected: true },
      { message: "THE USER ABORTED THIS REQUEST", expected: true },
    ]

    //#when
    const results = cases.map((entry) => isExplicitUserAbortSignal(entry.message))

    //#then
    expect(results).toEqual(cases.map((entry) => entry.expected))
  })

  test("does not classify technical mid-stream termination as an explicit user abort", () => {
    //#given
    const cases = [
      { message: "Connection terminated unexpectedly", expected: false },
      { message: "stream ended mid-response", expected: false },
      { message: "", expected: false },
    ]

    //#when
    const results = cases.map((entry) => isExplicitUserAbortSignal(entry.message))

    //#then
    expect(results).toEqual(cases.map((entry) => entry.expected))
  })
})
