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

  test("#given a billing exhaustion child failure #when classified #then it is not retryable because another model cannot fix it", () => {
    expect(classifyRetryableModelMiss(result("Error: quota exceeded for this organization"))).toBeUndefined()
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
