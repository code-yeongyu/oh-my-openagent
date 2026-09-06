import { describe, expect, test } from "bun:test"

import { classifyJudgeTurn, normalizeGateReason } from "./memorian-judge-outcome"

describe("classifyJudgeTurn", () => {
  test("#given a completed runner outcome #when classified #then the judge turn is completed", () => {
    expect(classifyJudgeTurn({ status: "completed", finalResponse: "" })).toEqual({ status: "completed" })
  })

  test("#given an error outcome with a multi-line provider message #when classified #then failed/child_failed carries the single-line normalized reason", () => {
    expect(classifyJudgeTurn({
      status: "error",
      failure: { kind: "child-turn-failed", message: "provider\nfailed\twhile judging" },
    })).toEqual({ status: "failed", cause: "child_failed", reason: "providerfailedwhile judging" })
  })

  test("#given a cancelled outcome #when classified #then the judge turn is dropped as cancelled", () => {
    expect(classifyJudgeTurn({ status: "cancelled" })).toEqual({ status: "dropped", cause: "cancelled" })
  })

  test("#given a 500-character message #when normalized #then it is capped at 160 characters ending with an ellipsis", () => {
    const reason = normalizeGateReason("x".repeat(500))
    expect(reason).toHaveLength(160)
    expect(reason?.endsWith("…")).toBe(true)
  })

  test("#given a message containing an Authorization bearer token #when normalized #then the reason is redacted", () => {
    expect(normalizeGateReason("Authorization: Bearer sk-live-abcdefghijklmnop")).toBe("redacted")
  })

  test("#given control characters and CRLF #when normalized #then they are removed", () => {
    expect(normalizeGateReason("line1\r\nline2\u0000\u0085line3")).toBe("line1line2line3")
  })

  test("#given an empty or whitespace message #when normalized #then the reason is undefined", () => {
    expect(normalizeGateReason(" \t\n\r ")).toBeUndefined()
    expect(normalizeGateReason(undefined)).toBeUndefined()
  })
})
