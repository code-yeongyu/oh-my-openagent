import { describe, it, expect } from "bun:test"
import { fixJsonSurrogateEscapes } from "./fix-json-surrogate-escapes"

describe("fixJsonSurrogateEscapes", () => {
  it("returns clean JSON unchanged", () => {
    const json = '{"key":"value","num":42}'
    expect(fixJsonSurrogateEscapes(json)).toBe(json)
  })

  it("replaces lone high surrogate escape", () => {
    expect(fixJsonSurrogateEscapes('{"x":"a\\uD800b"}')).toBe('{"x":"a\\uFFFDb"}')
  })

  it("replaces lone low surrogate escape", () => {
    expect(fixJsonSurrogateEscapes('{"x":"a\\uDC00b"}')).toBe('{"x":"a\\uFFFDb"}')
  })

  it("preserves valid surrogate pair escapes", () => {
    const json = '{"emoji":"\\uD83D\\uDE00"}'
    expect(fixJsonSurrogateEscapes(json)).toBe(json)
  })

  it("replaces high surrogate not followed by \\u escape", () => {
    expect(fixJsonSurrogateEscapes('{"x":"\\uD83Dhello"}')).toBe(
      '{"x":"\\uFFFDhello"}',
    )
  })

  it("replaces high surrogate followed by non-low surrogate escape", () => {
    expect(fixJsonSurrogateEscapes('{"x":"\\uD83D\\u0041"}')).toBe(
      '{"x":"\\uFFFD\\u0041"}',
    )
  })

  it("handles multiple lone surrogates in one string", () => {
    expect(fixJsonSurrogateEscapes('{"x":"\\uD800\\uD801"}')).toBe(
      '{"x":"\\uFFFD\\uFFFD"}',
    )
  })

  it("handles surrogates across multiple JSON strings", () => {
    expect(
      fixJsonSurrogateEscapes('{"a":"\\uD800","b":"ok","c":"\\uDFFF"}'),
    ).toBe('{"a":"\\uFFFD","b":"ok","c":"\\uFFFD"}')
  })

  it("does not touch escaped backslash before uD800", () => {
    const json = '{"x":"text\\\\uD800more"}'
    expect(fixJsonSurrogateEscapes(json)).toBe(json)
  })

  it("handles case-insensitive hex digits", () => {
    expect(fixJsonSurrogateEscapes('{"x":"\\ud800"}')).toBe('{"x":"\\uFFFD"}')
    expect(fixJsonSurrogateEscapes('{"x":"\\uDbFf"}')).toBe('{"x":"\\uFFFD"}')
  })

  it("preserves surrogate-like text outside JSON strings", () => {
    const json = '{"key":"value"}'
    expect(fixJsonSurrogateEscapes(json)).toBe(json)
  })

  it("returns empty string unchanged", () => {
    expect(fixJsonSurrogateEscapes("")).toBe("")
  })

  it("fast-path skips text without \\uD pattern", () => {
    const json = '{"messages":[{"role":"user","content":"hello world"}]}'
    expect(fixJsonSurrogateEscapes(json)).toBe(json)
  })
})
