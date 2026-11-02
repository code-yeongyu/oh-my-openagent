/// <reference types="bun-types" />

import { describe, expect, it } from "bun:test"

import { askWanderingGate, parseWanderingAnswer } from "./decision-gate"

function request(response: Response | Error) {
  return {
    url: "https://decisions.test/v1/decisions",
    model: "m",
    apiKey: "k",
    state: "s",
    timeoutMs: 1000,
    fetch: (async () => {
      if (response instanceof Error) throw response
      return response
    }) as unknown as typeof fetch,
  }
}

describe("decision gate", () => {
  it("#given a noul answer with usage #when parsed #then the probability and input tokens come back", () => {
    expect(parseWanderingAnswer({ answers: { wandering: { type: "noul", noul: 0.73 } }, usage: { input_tokens: 9 } })).toEqual({ kind: "scored", probability: 0.73, inputTokens: 9 })
  })

  it.each([
    [{}, "no_answers"],
    [{ answers: {} }, "no_answer"],
    [{ answers: { wandering: { noul: 1.5 } } }, "invalid_noul"],
    [{ answers: { wandering: { noul: "0.4" } } }, "invalid_noul"],
  ])("#given %j #when parsed #then it fails as %s", (body, reason) => {
    expect(parseWanderingAnswer(body)).toEqual({ kind: "failed", reason })
  })

  it("#given an HTTP error #when asked #then the status is the reason", async () => {
    expect(await askWanderingGate(request(new Response("nope", { status: 401 })))).toEqual({ kind: "failed", reason: "http_401" })
  })

  it("#given a network failure #when asked #then it resolves instead of throwing", async () => {
    expect(await askWanderingGate(request(new TypeError("boom")))).toEqual({ kind: "failed", reason: "TypeError" })
  })

  it("#given an empty key #when asked #then no request is made", async () => {
    let called = false
    const outcome = await askWanderingGate({ ...request(new Response("{}")), apiKey: "", fetch: (async () => { called = true; return new Response("{}") }) as unknown as typeof fetch })
    expect(outcome).toEqual({ kind: "no_key" })
    expect(called).toBe(false)
  })
})
