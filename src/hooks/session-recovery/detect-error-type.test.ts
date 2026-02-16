/// <reference types="bun-types" />
import { describe, expect, it } from "bun:test"
import { detectErrorType, extractMessageIndex } from "./detect-error-type"

describe("detectErrorType", () => {
  it("#given a tool_use/tool_result error #when detecting #then returns tool_result_missing", () => {
    //#given
    const error = { message: "tool_use block must be followed by tool_result" }

    //#when
    const result = detectErrorType(error)

    //#then
    expect(result).toBe("tool_result_missing")
  })

  it("#given a thinking block order error #when detecting #then returns thinking_block_order", () => {
    //#given
    const error = { message: "thinking must be the first block in the response" }

    //#when
    const result = detectErrorType(error)

    //#then
    expect(result).toBe("thinking_block_order")
  })

  it("#given a thinking disabled violation #when detecting #then returns thinking_disabled_violation", () => {
    //#given
    const error = { message: "thinking is disabled and cannot contain thinking blocks" }

    //#when
    const result = detectErrorType(error)

    //#then
    expect(result).toBe("thinking_disabled_violation")
  })

  it("#given an unrecognized error #when detecting #then returns null", () => {
    //#given
    const error = { message: "some random error" }

    //#when
    const result = detectErrorType(error)

    //#then
    expect(result).toBeNull()
  })

  it("#given a malformed error with circular references #when detecting #then returns null without crashing", () => {
    //#given
    const circular: Record<string, unknown> = {}
    circular.self = circular

    //#when
    const result = detectErrorType(circular)

    //#then
    expect(result).toBeNull()
  })

  it("#given a proxy error with non-standard structure #when detecting #then returns null without crashing", () => {
    //#given
    const proxyError = {
      data: "not-an-object",
      error: 42,
      nested: { deeply: { error: true } },
    }

    //#when
    const result = detectErrorType(proxyError)

    //#then
    expect(result).toBeNull()
  })

  it("#given a null error #when detecting #then returns null", () => {
    //#given
    const error = null

    //#when
    const result = detectErrorType(error)

    //#then
    expect(result).toBeNull()
  })

  it("#given an error with data.error containing message #when detecting #then extracts correctly", () => {
    //#given
    const error = {
      data: {
        error: {
          message: "tool_use block requires tool_result",
        },
      },
    }

    //#when
    const result = detectErrorType(error)

    //#then
    expect(result).toBe("tool_result_missing")
  })
})

describe("extractMessageIndex", () => {
  it("#given an error referencing messages.5 #when extracting #then returns 5", () => {
    //#given
    const error = { message: "Invalid value at messages.5: tool_result is required" }

    //#when
    const result = extractMessageIndex(error)

    //#then
    expect(result).toBe(5)
  })

  it("#given a malformed error #when extracting #then returns null without crashing", () => {
    //#given
    const circular: Record<string, unknown> = {}
    circular.self = circular

    //#when
    const result = extractMessageIndex(circular)

    //#then
    expect(result).toBeNull()
  })
})
