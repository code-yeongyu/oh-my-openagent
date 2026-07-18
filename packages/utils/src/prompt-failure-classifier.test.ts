import { describe, expect, test } from "bun:test"

import {
  extractPromptFailureMessage,
  isAmbiguousPostDispatchPromptFailure,
  isAmbiguousPromptDispatchFailure,
} from "./prompt-failure-classifier"

describe("extractPromptFailureMessage", () => {
  test("#given string and Error inputs #when extracting failure messages #then returns their text", () => {
    expect(extractPromptFailureMessage("unexpected eof")).toBe("unexpected eof")
    expect(extractPromptFailureMessage(new Error("timed out"))).toBe("timed out")
  })

  test("#given object with message #when extracting failure message #then prefers the message field", () => {
    expect(extractPromptFailureMessage({ message: "json parse error", code: "E_PARSE" })).toBe("json parse error")
  })

  test("#given object without string message #when extracting failure message #then serializes the object", () => {
    expect(extractPromptFailureMessage({ code: "E_PARSE" })).toBe('{"code":"E_PARSE"}')
  })

  test("#given circular object #when extracting failure message #then returns an empty string", () => {
    const value: Record<string, unknown> = {}
    value.self = value

    expect(extractPromptFailureMessage(value)).toBe("")
  })
})

describe("isAmbiguousPromptDispatchFailure", () => {
  test("#given known ambiguous transport errors #when classifying #then returns true", () => {
    expect(isAmbiguousPromptDispatchFailure("unexpected EOF while reading response")).toBe(true)
    expect(isAmbiguousPromptDispatchFailure("JSON parse error at position 1")).toBe(true)
    expect(isAmbiguousPromptDispatchFailure("Unexpected end of JSON input")).toBe(true)
    expect(isAmbiguousPromptDispatchFailure(new Error("request timed out"))).toBe(true)
  })

  test("#given ordinary provider rejection #when classifying #then returns false", () => {
    expect(isAmbiguousPromptDispatchFailure("model rejected the request")).toBe(false)
  })
})

describe("isAmbiguousPostDispatchPromptFailure", () => {
  test("#given ambiguous error after dispatch #when classifying #then returns true", () => {
    expect(
      isAmbiguousPostDispatchPromptFailure({
        dispatchAttempted: true,
        error: "unexpected eof",
        status: "failed",
      })
    ).toBe(true)
  })

  test("#given ambiguous error before dispatch #when classifying #then returns false", () => {
    expect(
      isAmbiguousPostDispatchPromptFailure({
        dispatchAttempted: false,
        error: "unexpected eof",
        status: "failed",
      })
    ).toBe(false)
  })
})
