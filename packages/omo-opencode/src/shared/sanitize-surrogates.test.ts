import { describe, expect, it } from "bun:test"
import { fixJsonSurrogateEscapes, sanitizeSurrogates } from "./sanitize-surrogates"

describe("fixJsonSurrogateEscapes", () => {
  it("replaces lone high surrogate escapes", () => {
    const input = "before \\uD800 after"
    expect(fixJsonSurrogateEscapes(input)).toBe("before \\uFFFD after")
  })

  it("replaces lone low surrogate escapes", () => {
    const input = "before \\uDC00 after"
    expect(fixJsonSurrogateEscapes(input)).toBe("before \\uFFFD after")
  })

  it("preserves valid surrogate escape pairs", () => {
    const input = "smile: \\uD83D\\uDE00"
    expect(fixJsonSurrogateEscapes(input)).toBe(input)
  })
})

describe("sanitizeSurrogates", () => {
  it("replaces lone UTF-16 high surrogates", () => {
    const input = `a${String.fromCharCode(0xd800)}b`
    expect(sanitizeSurrogates(input)).toBe("a\uFFFDb")
  })

  it("replaces lone UTF-16 low surrogates", () => {
    const input = `a${String.fromCharCode(0xdc00)}b`
    expect(sanitizeSurrogates(input)).toBe("a\uFFFDb")
  })

  it("keeps well-formed surrogate pairs", () => {
    const input = "emoji 😀"
    expect(sanitizeSurrogates(input)).toBe(input)
  })

  it("applies JSON escape cleanup before well-formed conversion", () => {
    const input = "value=\\uD800"
    expect(sanitizeSurrogates(input)).toBe("value=\\uFFFD")
  })
})
