import { describe, expect, it } from "bun:test"
import { DEFAULT_MAX_OUTPUT_BYTES } from "./language-support"
import { createSgResultFromStdout } from "./sg-compact-json-output"

describe("sg compact JSON output", () => {
  it("#given malformed non-truncated JSON #when parsed #then returns an empty result", () => {
    // given
    const stdout = "[not json"

    // when
    const result = createSgResultFromStdout(stdout)

    // then
    expect(result).toEqual({ matches: [], totalMatches: 0, truncated: false })
  })

  it("#given truncated malformed JSON cannot be salvaged #when parsed #then reports max output parse failure", () => {
    // given
    const stdout = `[{"file":"a",},${"x".repeat(DEFAULT_MAX_OUTPUT_BYTES)}`

    // when
    const result = createSgResultFromStdout(stdout)

    // then
    expect(result).toEqual({
      matches: [],
      totalMatches: 0,
      truncated: true,
      truncatedReason: "max_output_bytes",
      error: "Output too large and could not be parsed",
    })
  })
})
