import { describe, expect, it } from "bun:test"
import { stableStringify } from "./stable-stringify"

describe("stableStringify", () => {
  it("sorts nested keys recursively", () => {
    // given
    const value = { b: 1, a: { d: 4, c: 3 } }

    // when
    const result = stableStringify(value)

    // then
    expect(result).toBe('{"a":{"c":3,"d":4},"b":1}')
  })

  it("preserves array order", () => {
    // given
    const value = { list: [3, 1, 2] }

    // when
    const result = stableStringify(value)

    // then
    expect(result).toBe('{"list":[3,1,2]}')
  })

  it("omits undefined object properties", () => {
    // given
    const value = { a: 1, b: undefined }

    // when
    const result = stableStringify(value)

    // then
    expect(result).toBe('{"a":1}')
  })

  it("produces identical output for logically identical objects", () => {
    // given
    const first = { b: 1, a: { d: 4, c: 3 } }
    const second = { a: { c: 3, d: 4 }, b: 1 }

    // when
    const a = stableStringify(first)
    const b = stableStringify(second)

    // then
    expect(a).toBe(b)
  })
})
