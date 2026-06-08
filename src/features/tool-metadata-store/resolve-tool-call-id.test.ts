import { describe, expect, test } from "bun:test"

import { resolveToolCallID, type ToolCallIDCarrier } from "./resolve-tool-call-id"

describe("resolveToolCallID", () => {
  function makeCtx(overrides: Partial<ToolCallIDCarrier> = {}): ToolCallIDCarrier {
    return {
      ...overrides,
    }
  }

  test("#given callID is set #when resolving #then it returns callID", () => {
    // given
    const ctx = makeCtx({ callID: "call_abc" })

    // when
    const result = resolveToolCallID(ctx)

    // then
    expect(result).toBe("call_abc")
  })

  test("#given only callId is set #when resolving #then it returns callId", () => {
    // given
    const ctx = makeCtx({ callId: "call_def" })

    // when
    const result = resolveToolCallID(ctx)

    // then
    expect(result).toBe("call_def")
  })

  test("#given only call_id is set #when resolving #then it returns call_id", () => {
    // given
    const ctx = makeCtx({ call_id: "call_ghi" })

    // when
    const result = resolveToolCallID(ctx)

    // then
    expect(result).toBe("call_ghi")
  })

  test("#given surrounding whitespace #when resolving #then it trims the value", () => {
    // given
    const ctx = makeCtx({ callID: "  call_trimmed  " })

    // when
    const result = resolveToolCallID(ctx)

    // then
    expect(result).toBe("call_trimmed")
  })

  test("#given blank callID #when resolving #then it returns undefined", () => {
    // given
    const ctx = makeCtx({ callID: "" })

    // when
    const result = resolveToolCallID(ctx)

    // then
    expect(result).toBeUndefined()
  })

  test("#given whitespace callID #when resolving #then it returns undefined", () => {
    // given
    const ctx = makeCtx({ callID: "   " })

    // when
    const result = resolveToolCallID(ctx)

    // then
    expect(result).toBeUndefined()
  })

  test("#given no call id variants #when resolving #then it returns undefined", () => {
    // given
    const ctx = makeCtx()

    // when
    const result = resolveToolCallID(ctx)

    // then
    expect(result).toBeUndefined()
  })
})
