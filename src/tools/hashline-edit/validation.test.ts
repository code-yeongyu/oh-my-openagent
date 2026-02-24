import { describe, it, expect } from "bun:test"
import { computeLineHash } from "./hash-computation"
import { parseLineRef, validateLineRef, validateLineRefs } from "./validation"

describe("parseLineRef", () => {
  it("parses valid LINE#ID reference", () => {
    //#given
    const ref = "42#VK"

    //#when
    const result = parseLineRef(ref)

    //#then
    expect(result).toEqual({ line: 42, hash: "VK" })
  })

  it("throws on invalid format", () => {
    //#given
    const ref = "42:VK"

    //#when / #then
    expect(() => parseLineRef(ref)).toThrow("{line_number}#{hash_id}")
  })

  it("gives specific hint when literal text is used instead of line number", () => {
    //#given — model sends "LINE#HK" instead of "1#HK"
    const ref = "LINE#HK"

    //#when / #then — error should mention that LINE is not a valid number
    expect(() => parseLineRef(ref)).toThrow(/not a line number/i)
  })

  it("gives specific hint for other non-numeric prefixes like POS#VK", () => {
    //#given
    const ref = "POS#VK"

    //#when / #then
    expect(() => parseLineRef(ref)).toThrow(/not a line number/i)
  })

  it("extracts valid line number from mixed prefix like LINE42 without throwing", () => {
    //#given — normalizeLineRef extracts 42#VK from LINE42#VK
    const ref = "LINE42#VK"

    //#when / #then — should parse successfully as line 42
    const result = parseLineRef(ref)
    expect(result.line).toBe(42)
    expect(result.hash).toBe("VK")
  })

  it("gives specific hint when hyphenated prefix like line-ref is used", () => {
    //#given
    const ref = "line-ref#VK"

    //#when / #then
    expect(() => parseLineRef(ref)).toThrow(/not a line number/i)
  })

  it("gives specific hint when prefix contains a period like line.ref", () => {
    //#given
    const ref = "line.ref#VK"

    //#when / #then
    expect(() => parseLineRef(ref)).toThrow(/not a line number/i)
  })

  it("accepts refs copied with markers and trailing content", () => {
    //#given
    const ref = ">>> 42#VK|const value = 1"

    //#when
    const result = parseLineRef(ref)

    //#then
    expect(result).toEqual({ line: 42, hash: "VK" })
  })

  it("accepts refs copied with >>> marker only", () => {
    //#given
    const ref = ">>> 42#VK"

    //#when
    const result = parseLineRef(ref)

    //#then
    expect(result).toEqual({ line: 42, hash: "VK" })
  })

  it("accepts refs with spaces around hash separator", () => {
    //#given
    const ref = "42 # VK"

    //#when
    const result = parseLineRef(ref)

    //#then
    expect(result).toEqual({ line: 42, hash: "VK" })
  })
})

describe("validateLineRef", () => {
  it("accepts matching reference", () => {
    //#given
    const lines = ["function hello() {", "  return 42", "}"]
    const hash = computeLineHash(1, lines[0])

    //#when / #then
    expect(() => validateLineRef(lines, `1#${hash}`)).not.toThrow()
  })

  it("throws on mismatch and includes current hash", () => {
    //#given
    const lines = ["function hello() {"]

    //#when / #then
    expect(() => validateLineRef(lines, "1#ZZ")).toThrow(/>>>\s+1#[ZPMQVRWSNKTXJBYH]{2}\|/)
  })

  it("shows >>> mismatch context in batched validation", () => {
    //#given
    const lines = ["one", "two", "three", "four"]

    //#when / #then
    expect(() => validateLineRefs(lines, ["2#ZZ"]))
      .toThrow(/>>>\s+2#[ZPMQVRWSNKTXJBYH]{2}\|two/)
  })

  it("suggests correct line number when hash matches a file line", () => {
    //#given — model sends LINE#XX where XX is the actual hash for line 1
    const lines = ["function hello() {", "  return 42", "}"]
    const hash = computeLineHash(1, lines[0])

    //#when / #then — error should suggest the correct reference
    expect(() => validateLineRefs(lines, [`LINE#${hash}`])).toThrow(new RegExp(`1#${hash}`))
  })
})
