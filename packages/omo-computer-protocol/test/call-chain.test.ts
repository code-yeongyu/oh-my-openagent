import { describe, expect, test } from "vitest"

import { classifyCallChain, resolveOneshot } from "../src/index.ts"

describe("classifyCallChain", () => {
  test("a chain of read methods is read tier", () => {
    expect(classifyCallChain([{ method: "windows" }, { method: "observe" }])).toEqual({ kind: "tier", tier: "read" })
  })

  test("one exec hop makes the chain exec tier", () => {
    expect(classifyCallChain([{ method: "observe" }, { method: "click" }])).toEqual({ kind: "tier", tier: "exec" })
  })

  test("an unknown method refuses the chain before any hop", () => {
    expect(classifyCallChain([{ method: "observe" }, { method: "reset" }])).toEqual({
      kind: "refused",
      reason: "unknown_method",
      method: "reset",
    })
  })

  test("host-only and test-only methods are never model-callable", () => {
    expect(classifyCallChain([{ method: "stopPath.resume" }])).toEqual({
      kind: "refused",
      reason: "host_only",
      method: "stopPath.resume",
    })
    expect(classifyCallChain([{ method: "session.open" }])).toEqual({
      kind: "refused",
      reason: "host_only",
      method: "session.open",
    })
    expect(classifyCallChain([{ method: "$/test.advanceClock" }])).toEqual({
      kind: "refused",
      reason: "test_only",
      method: "$/test.advanceClock",
    })
  })

  test("an empty chain is refused", () => {
    expect(classifyCallChain([])).toEqual({ kind: "refused", reason: "empty_chain" })
  })
})

describe("resolveOneshot", () => {
  test("strips the prefix, follows the alias and keeps exact names", () => {
    expect(resolveOneshot("desktop.click")).toBe("click")
    expect(resolveOneshot("desktop.stop")).toBe("stopPath.stop")
    expect(resolveOneshot("desktop.shutdown")).toBe("desktop.shutdown")
    expect(resolveOneshot("desktop.nope")).toBeUndefined()
  })
})
