import { describe, expect, it } from "bun:test"
import { computeLineHash } from "./hash-computation"
import { normalizeLineRef, parseLineRef, validateLineRef } from "./validation"

describe("parseLineRef", () => {
  it("parses valid LINE#ID reference", () => {
    //#given
    const hash = computeLineHash(42, "function hello() {")
    const ref = `42#${hash}`

    //#when
    const result = parseLineRef(ref)

    //#then
    expect(result.line).toBe(42)
    expect(result.hash).toBe(hash)
  })

  it("parses line reference with line 1", () => {
    //#given
    const hash = computeLineHash(1, "const x = 1")
    const ref = `1#${hash}`

    //#when
    const result = parseLineRef(ref)

    //#then
    expect(result.line).toBe(1)
    expect(result.hash).toBe(hash)
  })

  it("throws on invalid format - no hash separator", () => {
    //#given
    const ref = "42ZP"

    //#when & #then
    expect(() => parseLineRef(ref)).toThrow()
  })

  it("throws on invalid format - non-numeric line", () => {
    //#given
    const ref = "abc#ZP"

    //#when & #then
    expect(() => parseLineRef(ref)).toThrow()
  })

  it("throws on invalid format - invalid hash chars (lowercase hex)", () => {
    //#given
    const ref = "42#a3"

    //#when & #then
    expect(() => parseLineRef(ref)).toThrow()
  })

  it("throws on empty string", () => {
    //#given
    const ref = ""

    //#when & #then
    expect(() => parseLineRef(ref)).toThrow()
  })

  it("strips pipe suffix when normalizing", () => {
    //#given
    const hash = computeLineHash(5, "const x = 1")
    const ref = `5#${hash}|const x = 1`

    //#when
    const result = parseLineRef(ref)

    //#then
    expect(result.line).toBe(5)
    expect(result.hash).toBe(hash)
  })
})

describe("normalizeLineRef", () => {
  it("strips >>> prefix", () => {
    //#given
    const hash = computeLineHash(3, "foo")
    const ref = `>>> 3#${hash}`

    //#when
    const result = normalizeLineRef(ref)

    //#then
    expect(result).toBe(`3#${hash}`)
  })

  it("strips pipe suffix", () => {
    //#given
    const hash = computeLineHash(3, "foo")
    const ref = `3#${hash}|foo`

    //#when
    const result = normalizeLineRef(ref)

    //#then
    expect(result).toBe(`3#${hash}`)
  })
})

describe("validateLineRef", () => {
  it("validates matching hash", () => {
    //#given
    const lines = ["function hello() {", "  return 42", "}"]
    const hash = computeLineHash(1, lines[0])
    const ref = `1#${hash}`

    //#when & #then
    expect(() => validateLineRef(lines, ref)).not.toThrow()
  })

  it("throws on hash mismatch", () => {
    //#given
    const lines = ["function hello() {", "  return 42", "}"]
    const ref = "1#ZZ"

    //#when & #then
    expect(() => validateLineRef(lines, ref)).toThrow()
  })

  it("throws on line out of bounds", () => {
    //#given
    const lines = ["function hello() {", "  return 42", "}"]
    const ref = "99#ZP"

    //#when & #then
    expect(() => validateLineRef(lines, ref)).toThrow()
  })

  it("throws on invalid line number (0)", () => {
    //#given
    const lines = ["function hello() {"]
    const ref = "0#ZP"

    //#when & #then
    expect(() => validateLineRef(lines, ref)).toThrow()
  })

  it("error message includes updated hash references", () => {
    //#given
    const lines = ["function hello() {"]
    const ref = "1#ZZ"

    //#when & #then
    expect(() => validateLineRef(lines, ref)).toThrow(/changed since last read/)
  })
})
