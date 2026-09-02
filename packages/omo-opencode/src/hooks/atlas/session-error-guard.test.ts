import { describe, expect, test } from "bun:test"
import { classifySessionError } from "./session-error-guard"

describe("classifySessionError", () => {
  test("#given the Anthropic compaction tool_use/tool_result 400 #then it is classified as unrecoverable", () => {
    // given
    const error = {
      name: "APIError",
      data: {
        message:
          "messages.2: `tool_use` ids were found without `tool_result` blocks immediately after: toolu_01PCXjcagoMAca32awicQHce.",
        statusCode: 400,
        isRetryable: false,
      },
    }

    // when
    const classification = classifySessionError(error)

    // then
    expect(classification.isAbort).toBe(false)
    expect(classification.isTokenLimit).toBe(false)
    expect(classification.isUnrecoverable).toBe(true)
  })

  test("#given a token limit error #then it is classified as token limit", () => {
    // given
    const error = {
      name: "APIError",
      data: { message: "prompt is too long: 250000 tokens > 200000 maximum", statusCode: 400, isRetryable: false },
    }

    // when
    const classification = classifySessionError(error)

    // then
    expect(classification.isAbort).toBe(false)
    expect(classification.isTokenLimit).toBe(true)
    expect(classification.isUnrecoverable).toBe(false)
  })

  test("#given an abort error #then it is classified as abort and nothing else", () => {
    // given
    const error = { name: "MessageAbortedError", message: "aborted" }

    // when
    const classification = classifySessionError(error)

    // then
    expect(classification.isAbort).toBe(true)
    expect(classification.isTokenLimit).toBe(false)
    expect(classification.isUnrecoverable).toBe(false)
  })

  test("#given a retryable provider error #then no terminal classification applies", () => {
    // given
    const error = { name: "APIError", data: { message: "overloaded", statusCode: 529, isRetryable: true } }

    // when
    const classification = classifySessionError(error)

    // then
    expect(classification.isAbort).toBe(false)
    expect(classification.isTokenLimit).toBe(false)
    expect(classification.isUnrecoverable).toBe(false)
  })

  test("#given a transient runtime error #then no terminal classification applies", () => {
    // given
    const error = new Error("provider overloaded")

    // when
    const classification = classifySessionError(error)

    // then
    expect(classification.isAbort).toBe(false)
    expect(classification.isTokenLimit).toBe(false)
    expect(classification.isUnrecoverable).toBe(false)
  })

  test("#given empty input #then nothing is classified", () => {
    // given / when / then
    expect(classifySessionError(undefined)).toEqual({
      info: undefined,
      isAbort: false,
      isTokenLimit: false,
      isUnrecoverable: false,
    })
  })
})
