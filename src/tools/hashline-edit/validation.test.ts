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
    expect(() => parseLineRef(ref)).toThrow("LINE#ID")
  })

  it("accepts refs copied with markers and trailing content", () => {
    //#given
    const ref = ">>> 42#VK|const value = 1"

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
})

describe("legacy LINE:HEX backward compatibility", () => {
  it("parses legacy LINE:HEX ref", () => {
    //#given
    const ref = "42:ab"

    //#when
    const result = parseLineRef(ref)

    //#then
    expect(result).toEqual({ line: 42, hash: "ab" })
  })

  it("parses legacy LINE:HEX ref with uppercase hex", () => {
    //#given
    const ref = "10:FF"

    //#when
    const result = parseLineRef(ref)

    //#then
    expect(result).toEqual({ line: 10, hash: "FF" })
  })

  it("legacy ref fails validation with hash mismatch, not parse error", () => {
    //#given
    const lines = ["function hello() {"]

    //#when / #then
    expect(() => validateLineRef(lines, "1:ab")).toThrow(/>>>\s+1#[ZPMQVRWSNKTXJBYH]{2}\|/)
  })

  it("extracts legacy ref from content with markers", () => {
    //#given
    const ref = ">>> 42:ab|const x = 1"

    //#when
    const result = parseLineRef(ref)

    //#then
    expect(result).toEqual({ line: 42, hash: "ab" })
  })
})
