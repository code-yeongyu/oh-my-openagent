import { describe, expect, test } from "bun:test"

import { classifyJudgeTurn, normalizeGateReason } from "./judge-outcome"

const NO_NUDGES: readonly never[] = []
const ONE_NUDGE = [{ path: "reference/kubernetes-rollouts.md", hint: "Drain nodes before a rollout." }] as const
/** senpi packages/agent/src/empty-assistant-recovery.ts turns a second invisible stop into this settled error. */
const EMPTY_RESPONSE_TWICE = "Model returned an empty response twice"

describe("classifyJudgeTurn", () => {
  test("#given a completed runner outcome #when classified #then the judge turn is completed", () => {
    expect(classifyJudgeTurn({ status: "completed", finalResponse: "" }, NO_NUDGES)).toEqual({ status: "completed" })
  })

  test("#given the engine's empty-response-twice error after an accepted nudge #when classified #then the judge turn is completed, not failed", () => {
    // given: the judge answered through `nudge`, then stopped silently twice; senpi's recovery settled that as an error
    const outcome = { status: "error", failure: { kind: "child-turn-failed", message: EMPTY_RESPONSE_TWICE } } as const

    // when / then
    expect(classifyJudgeTurn(outcome, ONE_NUDGE)).toEqual({ status: "completed" })
  })

  test("#given the engine's empty-response-twice error with no accepted nudge #when classified #then the judge turn is empty, not failed", () => {
    // given: a judge that had nothing to say stopped silently twice
    const outcome = { status: "error", failure: { kind: "child-turn-failed", message: EMPTY_RESPONSE_TWICE } } as const

    // when / then
    expect(classifyJudgeTurn(outcome, NO_NUDGES)).toEqual({ status: "empty" })
  })

  test("#given a different settled error after an accepted nudge #when classified #then the judge turn still fails", () => {
    expect(classifyJudgeTurn({
      status: "error",
      failure: { kind: "child-turn-failed", message: "provider exploded" },
    }, ONE_NUDGE)).toEqual({ status: "failed", cause: "child_failed", reason: "provider exploded" })
  })

  test("#given an error outcome with a multi-line provider message #when classified #then failed/child_failed carries the single-line normalized reason", () => {
    expect(classifyJudgeTurn({
      status: "error",
      failure: { kind: "child-turn-failed", message: "provider\nfailed\twhile judging" },
    }, NO_NUDGES)).toEqual({ status: "failed", cause: "child_failed", reason: "providerfailedwhile judging" })
  })

  test("#given an error outcome whose message is upstream-shaped #when classified #then failed/child_failed_upstream carries the sanitized reason", () => {
    // given: the engine settled the turn after its same-model budget and fallback chain were exhausted
    const message = "OpenAI API error (503): auth_unavailable (model gpt-5.6-luna, server_is_overloaded)"

    // when / then
    expect(classifyJudgeTurn({ status: "error", failure: { kind: "child-turn-failed", message } }, NO_NUDGES))
      .toEqual({ status: "failed", cause: "child_failed_upstream", reason: message })
  })

  test("#given a cancelled outcome #when classified #then the judge turn is dropped as cancelled", () => {
    expect(classifyJudgeTurn({ status: "cancelled" }, NO_NUDGES)).toEqual({ status: "dropped", cause: "cancelled" })
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
