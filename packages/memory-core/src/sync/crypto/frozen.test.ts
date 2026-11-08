import { describe, expect, test } from "bun:test"
import { frozenCopy, isReadonlyMap, isReadonlySet } from "./frozen.ts"

const keepNothing = (): boolean => false

// Security contract: a minted (verified) chain state carries no code, so nothing reachable from it can run or change.
describe("a verified state holds only plain data", () => {
  test("a function anywhere in the value is refused, not passed through unfrozen", () => {
    const nested = { head: { seq: 1 }, history: [{ body: { kind: "genesis", hook: () => "code" } }] }
    expect(() => frozenCopy(nested, keepNothing)).toThrow(TypeError)
    expect(() => frozenCopy({ members: new Map([["device", () => "code"]]) }, keepNothing)).toThrow(TypeError)
    expect(() => frozenCopy(() => "code", keepNothing)).toThrow(TypeError)
    expect(() => frozenCopy({ members: new Set([() => "code"]) }, keepNothing)).toThrow(TypeError)
    expect(() => frozenCopy({ members: new Map([[() => "code", "device"]]) }, keepNothing)).toThrow(TypeError)
  })
})

describe("a frozen map or set is a closed collection, not a Map or Set instance", () => {
  test("callers recognise closed and native collections through the guards, never through instanceof", () => {
    const { map, set } = frozenCopy({ map: new Map([["device", 1]]), set: new Set(["device"]) }, keepNothing)
    expect([map instanceof Map, set instanceof Set]).toEqual([false, false])
    expect([isReadonlyMap(map), isReadonlySet(set), isReadonlyMap(new Map()), isReadonlySet(new Set())]).toEqual([true, true, true, true])
    expect([isReadonlyMap(set), isReadonlySet(map), isReadonlyMap({ size: 0, get: () => undefined, has: () => false }), isReadonlySet(null)]).toEqual([false, false, false, false])
  })
})
