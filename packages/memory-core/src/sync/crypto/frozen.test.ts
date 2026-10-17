import { describe, expect, test } from "bun:test"
import { frozenCopy } from "./frozen.ts"

const keepNothing = (): boolean => false

// Security contract: a minted (verified) chain state carries no code, so nothing reachable from it can run or change.
describe("a verified state holds only plain data", () => {
  test("a function anywhere in the value is refused, not passed through unfrozen", () => {
    const nested = { head: { seq: 1 }, history: [{ body: { kind: "genesis", hook: () => "code" } }] }
    expect(() => frozenCopy(nested, keepNothing)).toThrow(TypeError)
    expect(() => frozenCopy({ members: new Map([["device", () => "code"]]) }, keepNothing)).toThrow(TypeError)
    expect(() => frozenCopy(() => "code", keepNothing)).toThrow(TypeError)
  })
})
