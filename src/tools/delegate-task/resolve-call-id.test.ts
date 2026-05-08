import { describe, test, expect } from "bun:test"
import { resolveCallID } from "./resolve-call-id"
import type { ToolContextWithMetadata } from "./types"

describe("resolveCallID", () => {
  function makeCtx(overrides: Partial<ToolContextWithMetadata> = {}): ToolContextWithMetadata {
    return {
      sessionID: "ses_test",
      messageID: "msg_test",
      agent: "sisyphus",
      abort: new AbortController().signal,
      ...overrides,
    }
  }

  test("#given callID is set #then returns callID", () => {
    const ctx = makeCtx({ callID: "call_abc" })
    expect(resolveCallID(ctx)).toBe("call_abc")
  })

  test("#given only callId is set #then returns callId", () => {
    const ctx = makeCtx({ callId: "call_def" })
    expect(resolveCallID(ctx)).toBe("call_def")
  })

  test("#given only call_id is set #then returns call_id", () => {
    const ctx = makeCtx({ call_id: "call_ghi" })
    expect(resolveCallID(ctx)).toBe("call_ghi")
  })

  test("#given callID and callId are both set #then prefers callID", () => {
    const ctx = makeCtx({ callID: "preferred", callId: "fallback" })
    expect(resolveCallID(ctx)).toBe("preferred")
  })

  test("#given no call ID variants are set #then returns undefined", () => {
    const ctx = makeCtx()
    expect(resolveCallID(ctx)).toBeUndefined()
  })
})
