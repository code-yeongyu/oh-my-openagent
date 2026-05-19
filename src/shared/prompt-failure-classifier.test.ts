import { describe, expect, test } from "bun:test"

import { isAmbiguousPromptDispatchFailure } from "./prompt-failure-classifier"

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
})
