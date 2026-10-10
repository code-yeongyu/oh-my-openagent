import { describe, expect, test } from "bun:test"

import { classifyRetryableModelMiss } from "./model-miss"

function result(stderr: string) {
  return { code: 1, stdout: "", stderr, timedOut: false }
}

describe("classifyRetryableModelMiss", () => {
  test("#given a model-not-found child failure #when classified #then it returns the missing model id", () => {
    const child = result('Error: Model "extension-only/primary" not found. Use --list-models to see available models.')
    expect(classifyRetryableModelMiss(child)).toEqual({ kind: "model_not_visible", id: "extension-only/primary" })
  })

  test("#given a missing API key child failure #when classified #then it returns the provider separately from model visibility", () => {
    const child = result("No API key found for anthropic")
    expect(classifyRetryableModelMiss(child)).toEqual({ kind: "auth_missing", provider: "anthropic" })
  })

  test("#given an OpenAI context overflow #when classified #then it returns context_overflow", () => {
    expect(classifyRetryableModelMiss(result("Your input exceeds the context window of this model"))).toEqual({
      kind: "context_overflow",
      detail: "Your input exceeds the context window of this model",
    })
  })

  test("#given an Anthropic context overflow #when classified #then it returns context_overflow", () => {
    expect(classifyRetryableModelMiss(result("prompt is too long: 213462 tokens > 200000 maximum"))).toEqual({
      kind: "context_overflow",
      detail: "prompt is too long: 213462 tokens > 200000 maximum",
    })
  })

  test("#given a provider cooldown 503 child failure #when classified #then it is retryable as a provider outage", () => {
    const child = result('503: {"message":"All providers are temporarily cooling down"}')
    expect(classifyRetryableModelMiss(child)).toEqual({
      kind: "provider_unavailable",
      detail: '503: {"message":"All providers are temporarily cooling down"}',
    })
  })

  test("#given an exhausted senpi fallback chain #when classified #then the provider outage is still retryable on the next candidate", () => {
    expect(classifyRetryableModelMiss(result("All configured providers are temporarily unavailable"))).toEqual({
      kind: "provider_unavailable",
      detail: "All configured providers are temporarily unavailable",
    })
  })

  test("#given a quota exhaustion child failure #when classified #then the next candidate may serve it (#6808)", () => {
    expect(classifyRetryableModelMiss(result("Error: quota exceeded for this organization"))).toEqual({
      kind: "provider_unavailable",
      detail: "Error: quota exceeded for this organization",
    })
  })

  test("#given a prompt-shaped child failure #when classified #then it is a context overflow the next candidate may fit", () => {
    // Before #7838 this was pinned as not retryable, which left the run dead with the same backlog
    // replaying forever; an overflow says THIS candidate is too small, not that reflection is impossible.
    expect(classifyRetryableModelMiss(result("Error: context length exceeded for the submitted transcript"))).toEqual({
      kind: "context_overflow",
      detail: "Error: context length exceeded for the submitted transcript",
    })
  })

  test("#given a timeout or successful child #when classified #then it is not retryable", () => {
    const timeout = { ...result("No API key found for anthropic"), timedOut: true }
    const success = { ...result("No API key found for anthropic"), code: 0 }
    expect(classifyRetryableModelMiss(timeout)).toBeUndefined()
    expect(classifyRetryableModelMiss(success)).toBeUndefined()
  })
})

describe("runtime advisories before the child's real failure (#9553)", () => {
  // Bun on win32 prints this once per terminated worker thread, before anything the child says.
  const REAPER_ADVISORY =
    "child reaper unavailable under Bun on win32: children orphaned by a terminated worker thread stay as zombies until this host exits"

  test("#given the reaper advisory then a non-provider error #when classified #then it is the child's own failure, not a provider outage", () => {
    // given
    const child = result(`${REAPER_ADVISORY}\nError: reflection worker could not open its session file`)

    // when
    const miss = classifyRetryableModelMiss(child)

    // then
    expect(miss).toBeUndefined()
  })

  test("#given the reaper advisory then a real rate limit #when classified #then it is a provider outage named by the provider's line", () => {
    // given
    const child = result(`${REAPER_ADVISORY}\n429: {"error":{"type":"rate_limit_error","message":"Too many requests"}}`)

    // when
    const miss = classifyRetryableModelMiss(child)

    // then
    expect(miss).toEqual({
      kind: "provider_unavailable",
      detail: '429: {"error":{"type":"rate_limit_error","message":"Too many requests"}}',
    })
  })

  test("#given only the reaper advisory #when classified #then nothing says a provider refused the model", () => {
    // given
    const child = result(REAPER_ADVISORY)

    // when
    const miss = classifyRetryableModelMiss(child)

    // then
    expect(miss).toBeUndefined()
  })

  test("#given an advisory we have never seen then a real error #when classified #then the real error decides, not the advisory's wording", () => {
    // given - an unknown notice whose wording alone would read as an outage
    const child = result("note: response cache temporarily unavailable, continuing without it\nError: reflection worker could not open its session file")

    // when
    const miss = classifyRetryableModelMiss(child)

    // then
    expect(miss).toBeUndefined()
  })

  test("#given a provider's own outage sentence then a stack error line #when classified #then the provider's sentence decides", () => {
    // given - senpi prints the provider's answer first; a stack that follows must not replace it
    const child = result("The model is temporarily unavailable\nError: request failed\n    at send (provider.js:10:3)")

    // when
    const miss = classifyRetryableModelMiss(child)

    // then
    expect(miss).toEqual({ kind: "provider_unavailable", detail: "The model is temporarily unavailable" })
  })
})
