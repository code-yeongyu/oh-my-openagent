import { describe, expect, test } from "bun:test"

import { classifyRetryableModelMiss } from "./model-miss"

function result(stderr: string) {
  return { code: 1, stdout: "", stderr, timedOut: false }
}

describe("classifyRetryableModelMiss", () => {
  test("#given a model-not-found child failure #when classified #then it returns the missing model id", () => {
    // given
    const child = result('Error: Model "extension-only/primary" not found. Use --list-models to see available models.')

    // when
    const miss = classifyRetryableModelMiss(child)

    // then
    expect(miss).toEqual({ kind: "model_not_visible", id: "extension-only/primary" })
  })

  test("#given a missing API key child failure #when classified #then it returns the provider separately from model visibility", () => {
    // given
    const child = result("No API key found for anthropic")

    // when
    const miss = classifyRetryableModelMiss(child)

    // then
    expect(miss).toEqual({ kind: "auth_missing", provider: "anthropic" })
  })

  test("#given a timeout or successful child #when classified #then it is not retryable", () => {
    // given
    const timeout = { ...result("No API key found for anthropic"), timedOut: true }
    const success = { ...result("No API key found for anthropic"), code: 0 }

    // when / then
    expect(classifyRetryableModelMiss(timeout)).toBeUndefined()
    expect(classifyRetryableModelMiss(success)).toBeUndefined()
  })
})
