/// <reference types="bun-types" />

import { describe, expect, it } from "bun:test"

import { askDecisionGate, buildGateState, gateFires, parseGateAnswers } from "./decision-gate"
import { createAdvisorSessionWindow, recordToolResult, rememberTask } from "./session-window"

const JUDGED = {
  answers: {
    stuck: { type: "noul", noul: 0.93 },
    kind: { type: "choice", choice: "error_streak", probabilities: { error_streak: 0.94 }, confidence: 0.92 },
  },
  usage: { input_tokens: 818 },
}

function request(response: Response | Error) {
  const window = createAdvisorSessionWindow(0)
  return {
    url: "https://decisions.test/v1/decisions",
    model: "m",
    apiKey: "k",
    state: buildGateState(window, 0),
    timeoutMs: 1000,
    fetch: (async () => {
      if (response instanceof Error) throw response
      return response
    }) as unknown as typeof fetch,
  }
}

describe("decision gate", () => {
  it("#given a judged answer #when parsed #then stuck, kind, confidence and tokens come back", () => {
    expect(parseGateAnswers(JUDGED)).toEqual({ kind: "judged", stuck: 0.93, trouble: "error_streak", confidence: 0.92, inputTokens: 818 })
  })

  it.each([
    [{}, "no_answers"],
    [{ answers: { kind: JUDGED.answers.kind } }, "invalid_stuck"],
    [{ answers: { stuck: { noul: 1.5 }, kind: JUDGED.answers.kind } }, "invalid_stuck"],
    [{ answers: { stuck: { noul: 0.9 }, kind: { choice: "made_up" } } }, "invalid_kind"],
  ])("#given %j #when parsed #then it fails as %s", (body, reason) => {
    expect(parseGateAnswers(body)).toEqual({ kind: "failed", reason })
  })

  it.each([
    [0.93, "error_streak", 0.92, true],
    [0.69, "error_streak", 0.92, false],
    [0.93, "none", 0.92, false],
    [0.93, "wait_misuse", 0.3, false],
  ] as const)("#given stuck %p kind %p confidence %p #when the rule is applied #then it fires: %p", (stuck, trouble, confidence, fires) => {
    expect(gateFires({ kind: "judged", stuck, trouble, confidence }, 0.7, 0.4)).toBe(fires)
  })

  it("#given a repeated failing call #when the state is built #then the counts describe the loop", () => {
    const window = createAdvisorSessionWindow(0)
    rememberTask(window, "make the build pass")
    recordToolResult(window, "read", { path: "a.ts" }, false, [{ type: "text", text: "ok" }], 24)
    for (let index = 0; index < 3; index += 1) recordToolResult(window, "bash", { command: "make" }, true, [{ type: "text", text: "error: foo.h" }], 24)
    recordToolResult(window, "bash_output", { bash_id: "b1" }, true, "error: foo.h", 24)
    const state = buildGateState(window, 45_000)
    expect(state.task).toBe("make the build pass")
    expect(state.recent_calls).toHaveLength(5)
    expect(state.counts).toEqual({ identical_run: 1, same_resource_unchanged: 1, poll_calls_in_window: 1, error_run: 4 })
    expect(state.seconds_since_last_message).toBe(45)
  })

  it("#given an HTTP error #when asked #then the status is the reason", async () => {
    expect(await askDecisionGate(request(new Response("nope", { status: 401 })))).toEqual({ kind: "failed", reason: "http_401" })
  })

  it("#given a network failure #when asked #then it resolves instead of throwing", async () => {
    expect(await askDecisionGate(request(new TypeError("boom")))).toEqual({ kind: "failed", reason: "TypeError" })
  })

  it("#given an empty key #when asked #then no request is made", async () => {
    let called = false
    const outcome = await askDecisionGate({ ...request(new Response("{}")), apiKey: "", fetch: (async () => { called = true; return new Response("{}") }) as unknown as typeof fetch })
    expect(outcome).toEqual({ kind: "no_key" })
    expect(called).toBe(false)
  })
})
