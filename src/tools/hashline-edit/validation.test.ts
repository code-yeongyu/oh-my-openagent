import { describe, it, expect } from "bun:test"
import { computeLineHash } from "./hash-computation"
import { parseLineRef, validateLineRef } from "./validation"

describe("parseLineRef", () => {
  it("parses valid line reference", () => {
    //#given
    const ref = "42:a3"

    //#when
    const result = parseLineRef(ref)

    //#then
    expect(result).toEqual({ line: 42, hash: "a3" })
  })

  it("parses line reference with different hash", () => {
    //#given
    const ref = "1:ff"

    //#when
    const result = parseLineRef(ref)

    //#then
    expect(result).toEqual({ line: 1, hash: "ff" })
  })

  it("throws on invalid format - no colon", () => {
    //#given
    const ref = "42a3"

    //#when & #then
    expect(() => parseLineRef(ref)).toThrow()
  })

  it("throws on invalid format - non-numeric line", () => {
    //#given
    const ref = "abc:a3"

    //#when & #then
    expect(() => parseLineRef(ref)).toThrow()
  })

  it("throws on invalid format - invalid hash", () => {
    //#given
    const ref = "42:xyz"

    //#when & #then
    expect(() => parseLineRef(ref)).toThrow()
  })

  it("throws on empty string", () => {
    //#given
    const ref = ""

    //#when & #then
    expect(() => parseLineRef(ref)).toThrow()
  })
})

describe("validateLineRef", () => {
  it("validates matching hash", () => {
    //#given
    const lines = ["function hello() {", "  return 42", "}"]
    const ref = `1:${computeLineHash(1, lines[0])}`

    //#when & #then
    expect(() => validateLineRef(lines, ref)).not.toThrow()
  })

  it("throws on hash mismatch", () => {
    //#given
    const lines = ["function hello() {", "  return 42", "}"]
    const ref = "1:00" // Wrong hash

    //#when & #then
    expect(() => validateLineRef(lines, ref)).toThrow()
  })

  it("throws on line out of bounds", () => {
    //#given
    const lines = ["function hello() {", "  return 42", "}"]
    const ref = "99:a3"

    //#when & #then
    expect(() => validateLineRef(lines, ref)).toThrow()
  })

  it("throws on invalid line number", () => {
    //#given
    const lines = ["function hello() {"]
    const ref = "0:a3" // Line numbers start at 1

    //#when & #then
    expect(() => validateLineRef(lines, ref)).toThrow()
  })

  it("error message includes current hash", () => {
    //#given
    const lines = ["function hello() {"]
    const ref = "1:00"

    //#when & #then
    expect(() => validateLineRef(lines, ref)).toThrow(/current hash/)
  })
})
