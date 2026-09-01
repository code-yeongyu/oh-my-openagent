import { describe, expect, test } from "bun:test"

import {
  isAmbiguousPostDispatchPromptFailure,
  isAmbiguousPromptDispatchFailure,
} from "./prompt-failure-classifier"

describe("prompt failure classifier", () => {
  test("#given prompt dispatch reports a generic JSON parse error #when classifying ambiguity #then it treats the dispatch as possibly accepted", () => {
    // given
    const error = new Error("JSON Parse error: Unexpected end of JSON input")

    // when
    const ambiguous = isAmbiguousPromptDispatchFailure(error)

    // then
    expect(ambiguous).toBe(true)
  })

  test("#given prompt dispatch timeout casing varies #when classifying ambiguity #then it treats the dispatch as possibly accepted", () => {
    // given
    const error = "PromptAsync Timed Out after 30000ms"

    // when
    const ambiguous = isAmbiguousPromptDispatchFailure(error)

    // then
    expect(ambiguous).toBe(true)
  })

  test("#given error serialization fails with an Error #when classifying ambiguity #then it uses the empty-message fallback", () => {
    // given
    const error = {
      toJSON() {
        throw new Error("cannot serialize")
      },
    }

    // when
    const ambiguous = isAmbiguousPromptDispatchFailure(error)

    // then
    expect(ambiguous).toBe(false)
  })

  test("#given error serialization fails with a non-Error #when classifying ambiguity #then it uses the empty-message fallback", () => {
    // given
    const thrown = { kind: "serializer-thrown-value" } as const
    const error = {
      toJSON() {
        throw thrown
      },
    }

    // when
    const ambiguous = isAmbiguousPromptDispatchFailure(error)

    // then
    expect(ambiguous).toBe(false)
  })

  test("#given ambiguous failure before dispatch #when classifying post-dispatch acceptance #then it is not treated as accepted", () => {
    // given
    const result = {
      status: "failed" as const,
      dispatchAttempted: false,
      error: new Error("JSON Parse error: Unexpected EOF"),
    }

    // when
    const ambiguous = isAmbiguousPostDispatchPromptFailure(result)

    // then
    expect(ambiguous).toBe(false)
  })

  test("#given ambiguous failure after dispatch #when classifying post-dispatch acceptance #then it is treated as accepted", () => {
    // given
    const result = {
      status: "failed" as const,
      dispatchAttempted: true,
      error: new Error("JSON Parse error: Unexpected EOF"),
    }

    // when
    const ambiguous = isAmbiguousPostDispatchPromptFailure(result)

    // then
    expect(ambiguous).toBe(true)
  })
})
