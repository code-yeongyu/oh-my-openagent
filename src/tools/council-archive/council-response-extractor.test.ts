import { describe, expect, it } from "bun:test"
import { CLOSING_TAG, extractCouncilResponse, MIN_RESPONSE_LENGTH, OPENING_TAG } from "./council-response-extractor"

function legacyExtractCouncilResponse(fullText: string) {
  const lastCloseIdx = legacyFindLastStructuralClose(fullText)

  if (lastCloseIdx === -1) {
    const lastOpenIdx = legacyFindLastStructuralOpen(fullText)
    if (lastOpenIdx === -1) {
      return { has_response: false, response_complete: false, result: null }
    }
    const partial = fullText.slice(lastOpenIdx + OPENING_TAG.length).trim()
    return { has_response: true, response_complete: false, result: partial || null }
  }

  const openAfterLastClose = legacyFindFirstStructuralOpenAfter(fullText, lastCloseIdx + CLOSING_TAG.length)
  if (openAfterLastClose !== -1) {
    const partial = fullText.slice(openAfterLastClose + OPENING_TAG.length).trim()
    return { has_response: true, response_complete: false, result: partial || null }
  }

  const matchingOpenIdx = legacyFindLastStructuralOpenBefore(fullText, lastCloseIdx)
  if (matchingOpenIdx === -1) {
    return { has_response: false, response_complete: false, result: null }
  }

  const content = fullText.slice(matchingOpenIdx + OPENING_TAG.length, lastCloseIdx).trim()

  if (content.length === 0) {
    return { has_response: false, response_complete: true, result: content }
  }

  if (content.length < MIN_RESPONSE_LENGTH) {
    return { has_response: true, response_complete: true, result: content }
  }

  return { has_response: true, response_complete: true, result: content }
}

function legacyIsStructuralOpen(text: string, idx: number): boolean {
  if (idx === 0) return true
  const prevNewline = text.lastIndexOf("\n", idx - 1)
  const lineStart = prevNewline === -1 ? 0 : prevNewline + 1
  const between = text.slice(lineStart, idx)
  return between.split("").every((ch) => ch === " " || ch === "\t")
}

function legacyIsStructuralClose(text: string, idx: number): boolean {
  const afterIdx = idx + CLOSING_TAG.length
  if (afterIdx === text.length) return true
  const nextNewline = text.indexOf("\n", afterIdx)
  const lineEnd = nextNewline === -1 ? text.length : nextNewline
  const between = text.slice(afterIdx, lineEnd)
  return between.split("").every((ch) => ch === " " || ch === "\t" || ch === "\r")
}

function legacyFindLastStructuralClose(text: string): number {
  let searchFrom = text.length
  while (searchFrom >= 0) {
    const idx = text.lastIndexOf(CLOSING_TAG, searchFrom - 1)
    if (idx === -1) return -1
    if (legacyIsStructuralClose(text, idx)) return idx
    searchFrom = idx
  }
  return -1
}

function legacyFindLastStructuralOpen(text: string): number {
  let searchFrom = text.length
  while (searchFrom >= 0) {
    const idx = text.lastIndexOf(OPENING_TAG, searchFrom - 1)
    if (idx === -1) return -1
    if (legacyIsStructuralOpen(text, idx)) return idx
    searchFrom = idx
  }
  return -1
}

function legacyFindFirstStructuralOpenAfter(text: string, fromIdx: number): number {
  let searchFrom = fromIdx
  while (searchFrom < text.length) {
    const idx = text.indexOf(OPENING_TAG, searchFrom)
    if (idx === -1) return -1
    if (legacyIsStructuralOpen(text, idx)) return idx
    searchFrom = idx + OPENING_TAG.length
  }
  return -1
}

function legacyFindLastStructuralOpenBefore(text: string, beforeIdx: number): number {
  let searchFrom = beforeIdx
  let nestedCloseCount = 0

  while (searchFrom > 0) {
    const openIdx = text.lastIndexOf(OPENING_TAG, searchFrom - 1)
    const closeIdx = text.lastIndexOf(CLOSING_TAG, searchFrom - 1)

    if (openIdx === -1 && closeIdx === -1) return -1

    if (closeIdx > openIdx) {
      if (legacyIsStructuralClose(text, closeIdx)) {
        nestedCloseCount += 1
      }
      searchFrom = closeIdx
      continue
    }

    if (!legacyIsStructuralOpen(text, openIdx)) {
      searchFrom = openIdx
      continue
    }

    if (nestedCloseCount === 0) return openIdx
    nestedCloseCount -= 1
    searchFrom = openIdx
  }

  return -1
}

function measureAverageMs(fn: () => void, iterations: number): number {
  for (let i = 0; i < 3; i++) {
    fn()
  }

  const start = performance.now()
  for (let i = 0; i < iterations; i++) {
    fn()
  }
  return (performance.now() - start) / iterations
}

function buildNestedResponse(depth: number): string {
  return [
    ...Array.from({ length: depth }, () => OPENING_TAG),
    "a".repeat(MIN_RESPONSE_LENGTH),
    ...Array.from({ length: depth }, () => CLOSING_TAG),
  ].join("\n")
}

describe("extractCouncilResponse", () => {
  describe("#given complete COUNCIL_MEMBER_RESPONSE tags", () => {
    it("#then returns has_response true, response_complete true, and the content", () => {
      const result = extractCouncilResponse("<COUNCIL_MEMBER_RESPONSE>" + "a".repeat(100) + "</COUNCIL_MEMBER_RESPONSE>")

      expect(result).toEqual({
        has_response: true,
        response_complete: true,
        result: "a".repeat(100),
      })
    })
  })

  describe("#given incomplete tags (opening but no closing)", () => {
    it("#then returns has_response true, response_complete false, and partial content", () => {
      const result = extractCouncilResponse("<COUNCIL_MEMBER_RESPONSE>partial analysis")

      expect(result).toEqual({
        has_response: true,
        response_complete: false,
        result: "partial analysis",
      })
    })
  })

  describe("#given missing tags (no opening tag)", () => {
    it("#then returns has_response false, response_complete false, and null result", () => {
      const result = extractCouncilResponse("Just some plain text without any tags.")

      expect(result).toEqual({
        has_response: false,
        response_complete: false,
        result: null,
      })
    })
  })

  describe("#given empty content between tags", () => {
    it("#then returns has_response false, response_complete true, and empty string result", () => {
      const result = extractCouncilResponse("<COUNCIL_MEMBER_RESPONSE></COUNCIL_MEMBER_RESPONSE>")

      expect(result).toEqual({
        has_response: false,
        response_complete: true,
        result: "",
      })
    })
  })

  describe("#given multiple tag pairs", () => {
    it("#then returns content from the last opening tag", () => {
      const text =
        `<COUNCIL_MEMBER_RESPONSE>${"first".repeat(20)}</COUNCIL_MEMBER_RESPONSE>\nSome interim text\n<COUNCIL_MEMBER_RESPONSE>${"final".repeat(20)}</COUNCIL_MEMBER_RESPONSE>`
      const result = extractCouncilResponse(text)

      expect(result).toEqual({
        has_response: true,
        response_complete: true,
        result: "final".repeat(20),
      })
    })
  })

  describe("#given response body contains literal COUNCIL_MEMBER_RESPONSE tag text", () => {
    it("#then extracts the actual tagged response, not the discussed tag", () => {
      const text = [
        "Here is my exploration log where I discuss the tag format.",
        "The system uses <COUNCIL_MEMBER_RESPONSE> tags for extraction.",
        "Now here is my actual response:",
        "<COUNCIL_MEMBER_RESPONSE>",
        "## Finding 1: Tag discussion in body",
        "The extractor uses lastIndexOf to find the opening tag, which ensures the last response is extracted.",
        "</COUNCIL_MEMBER_RESPONSE>",
      ].join("\n")
      const result = extractCouncilResponse(text)
      expect(result).toEqual({
        has_response: true,
        response_complete: true,
        result: "## Finding 1: Tag discussion in body\nThe extractor uses lastIndexOf to find the opening tag, which ensures the last response is extracted.",
      })
    })
  })

  describe("#given literal opening AND closing tags appear inside the actual response body", () => {
    it("#then extracts the full structural response, not the literal mention", () => {
      const text = [
        "<COUNCIL_MEMBER_RESPONSE>",
        "## Finding 1: Triplicated Tag Constants",
        "- Evidence:",
        '  - `council-response-extractor.ts:1-2`: `export const OPENING_TAG = "<COUNCIL_MEMBER_RESPONSE>"`, `export const CLOSING_TAG = "</COUNCIL_MEMBER_RESPONSE>"`',
        "## Finding 2: Another issue",
        "Some more analysis text here.",
        "</COUNCIL_MEMBER_RESPONSE>",
      ].join("\n")
      const result = extractCouncilResponse(text)

      expect(result).toEqual({
        has_response: true,
        response_complete: true,
        result: [
          "## Finding 1: Triplicated Tag Constants",
          "- Evidence:",
          '  - `council-response-extractor.ts:1-2`: `export const OPENING_TAG = "<COUNCIL_MEMBER_RESPONSE>"`, `export const CLOSING_TAG = "</COUNCIL_MEMBER_RESPONSE>"`',
          "## Finding 2: Another issue",
          "Some more analysis text here.",
        ].join("\n"),
      })
    })
  })

  describe("#given multiple literal tag mentions scattered inside the response body", () => {
    it("#then extracts the full structural response ignoring all literal mentions", () => {
      const text = [
        "preamble text",
        "<COUNCIL_MEMBER_RESPONSE>",
        "The system uses <COUNCIL_MEMBER_RESPONSE> for opening.",
        "And </COUNCIL_MEMBER_RESPONSE> for closing.",
        "Also mentions <COUNCIL_MEMBER_RESPONSE> again here.",
        "Final analysis paragraph.",
        "</COUNCIL_MEMBER_RESPONSE>",
      ].join("\n")
      const result = extractCouncilResponse(text)

      expect(result).toEqual({
        has_response: true,
        response_complete: true,
        result: [
          "The system uses <COUNCIL_MEMBER_RESPONSE> for opening.",
          "And </COUNCIL_MEMBER_RESPONSE> for closing.",
          "Also mentions <COUNCIL_MEMBER_RESPONSE> again here.",
          "Final analysis paragraph.",
        ].join("\n"),
      })
    })
  })

  describe("#given a complete pair followed by a trailing incomplete opening tag", () => {
    it("#then returns the incomplete trailing content as partial response", () => {
      const text = [
        "<COUNCIL_MEMBER_RESPONSE>first complete</COUNCIL_MEMBER_RESPONSE>",
        "<COUNCIL_MEMBER_RESPONSE>partial trailing content",
      ].join("\n")
      const result = extractCouncilResponse(text)

      expect(result).toEqual({
        has_response: true,
        response_complete: false,
        result: "partial trailing content",
      })
    })
  })

  describe("#given an empty string", () => {
    it("#then returns has_response false and null result", () => {
      const result = extractCouncilResponse("")

      expect(result).toEqual({
        has_response: false,
        response_complete: false,
        result: null,
      })
    })
  })

  describe("#given whitespace-only content between tags", () => {
    it("#then returns has_response false, response_complete true, and empty string result", () => {
      const result = extractCouncilResponse("<COUNCIL_MEMBER_RESPONSE>   </COUNCIL_MEMBER_RESPONSE>")

      expect(result).toEqual({
        has_response: false,
        response_complete: true,
        result: "",
      })
    })
  })

  describe("#given content with surrounding text before the opening tag", () => {
    it("#then returns only the tagged content", () => {
      const text = `Some preamble text\n<COUNCIL_MEMBER_RESPONSE>${"a".repeat(100)}</COUNCIL_MEMBER_RESPONSE>`
      const result = extractCouncilResponse(text)

      expect(result).toEqual({
        has_response: true,
        response_complete: true,
        result: "a".repeat(100),
      })
    })
  })

  describe("#given 99-char content between tags (below MIN_RESPONSE_LENGTH)", () => {
    it("#then returns has_response true (softened, not hard failure), response_complete true", () => {
      const content = "a".repeat(99)
      const result = extractCouncilResponse(`<COUNCIL_MEMBER_RESPONSE>${content}</COUNCIL_MEMBER_RESPONSE>`)

      expect(result).toEqual({
        has_response: true,
        response_complete: true,
        result: content,
      })
    })
  })

  describe("#given 100-char content between tags (exactly MIN_RESPONSE_LENGTH)", () => {
    it("#then returns has_response true, response_complete true", () => {
      const content = "a".repeat(100)
      const result = extractCouncilResponse(`<COUNCIL_MEMBER_RESPONSE>${content}</COUNCIL_MEMBER_RESPONSE>`)

      expect(result).toEqual({
        has_response: true,
        response_complete: true,
        result: content,
      })
    })
  })

  describe("#given 101-char content between tags (above MIN_RESPONSE_LENGTH)", () => {
    it("#then returns has_response true, response_complete true", () => {
      const content = "a".repeat(101)
      const result = extractCouncilResponse(`<COUNCIL_MEMBER_RESPONSE>${content}</COUNCIL_MEMBER_RESPONSE>`)

      expect(result).toEqual({
        has_response: true,
        response_complete: true,
        result: content,
      })
    })
  })

  describe("#given CRLF line endings throughout the response", () => {
    it("#then extracts content correctly with \\r\\n line endings", () => {
      const content = "a".repeat(100)
      const text = `<COUNCIL_MEMBER_RESPONSE>\r\n${content}\r\n</COUNCIL_MEMBER_RESPONSE>`
      const result = extractCouncilResponse(text)

      expect(result).toEqual({
        has_response: true,
        response_complete: true,
        result: content,
      })
    })
  })

  describe("#given closing tag followed by \\r\\n", () => {
    it("#then recognizes the closing tag as structural", () => {
      const content = "a".repeat(100)
      const text = `<COUNCIL_MEMBER_RESPONSE>${content}</COUNCIL_MEMBER_RESPONSE>\r\nsome trailing text`
      const result = extractCouncilResponse(text)

      expect(result).toEqual({
        has_response: true,
        response_complete: true,
        result: content,
      })
    })
  })

  describe("#given mixed \\n and \\r\\n line endings", () => {
    it("#then extracts content correctly regardless of mixed line endings", () => {
      const longLine = "a".repeat(80)
      const text = [
        "<COUNCIL_MEMBER_RESPONSE>",
        "## Finding 1: Mixed endings",
        longLine,
        "</COUNCIL_MEMBER_RESPONSE>",
      ].join("\r\n")
      const result = extractCouncilResponse(text)

      expect(result).toEqual({
        has_response: true,
        response_complete: true,
        result: `## Finding 1: Mixed endings\r\n${longLine}`,
      })
    })
  })

  describe("#given leading spaces before opening tag", () => {
    it("#then recognizes the tag as structural and extracts content", () => {
      const content = "a".repeat(100)
      const text = `  <COUNCIL_MEMBER_RESPONSE>\n${content}\n</COUNCIL_MEMBER_RESPONSE>`
      const result = extractCouncilResponse(text)

      expect(result).toEqual({
        has_response: true,
        response_complete: true,
        result: content,
      })
    })
  })

  describe("#given leading tab before opening tag", () => {
    it("#then recognizes the tag as structural and extracts content", () => {
      const content = "a".repeat(100)
      const text = `\t<COUNCIL_MEMBER_RESPONSE>\n${content}\n</COUNCIL_MEMBER_RESPONSE>`
      const result = extractCouncilResponse(text)

      expect(result).toEqual({
        has_response: true,
        response_complete: true,
        result: content,
      })
    })
  })

  describe("#given trailing spaces after closing tag", () => {
    it("#then recognizes the closing tag as structural and extracts content", () => {
      const content = "a".repeat(100)
      const text = `<COUNCIL_MEMBER_RESPONSE>\n${content}\n</COUNCIL_MEMBER_RESPONSE>  `
      const result = extractCouncilResponse(text)

      expect(result).toEqual({
        has_response: true,
        response_complete: true,
        result: content,
      })
    })
  })

  describe("#given inline opening tag (text before tag on same line)", () => {
    it("#then rejects the inline tag and returns has_response false", () => {
      const content = "a".repeat(100)
      const text = `text <COUNCIL_MEMBER_RESPONSE>\n${content}\n</COUNCIL_MEMBER_RESPONSE>`
      const result = extractCouncilResponse(text)

      expect(result).toEqual({
        has_response: false,
        response_complete: false,
        result: null,
      })
    })
  })

  describe("#given response with leading/trailing whitespace (99 chars after trim)", () => {
    it("#then trims before checking MIN_RESPONSE_LENGTH and returns has_response true (softened)", () => {
      const content = "a".repeat(99)
      const text = `<COUNCIL_MEMBER_RESPONSE>   ${content}   </COUNCIL_MEMBER_RESPONSE>`
      const result = extractCouncilResponse(text)

      expect(result).toEqual({
        has_response: true,
        response_complete: true,
        result: content,
      })
    })
  })

  describe("#given response with leading/trailing whitespace (100 chars after trim)", () => {
    it("#then trims before checking MIN_RESPONSE_LENGTH and returns has_response true", () => {
      const content = "a".repeat(100)
      const text = `<COUNCIL_MEMBER_RESPONSE>   ${content}   </COUNCIL_MEMBER_RESPONSE>`
      const result = extractCouncilResponse(text)

      expect(result).toEqual({
        has_response: true,
        response_complete: true,
        result: content,
      })
    })
  })

  describe("#given response with newlines and spaces (100 chars after trim)", () => {
    it("#then trims all whitespace before checking MIN_RESPONSE_LENGTH", () => {
      const content = "a".repeat(100)
      const text = `<COUNCIL_MEMBER_RESPONSE>\n  \n${content}\n  \n</COUNCIL_MEMBER_RESPONSE>`
      const result = extractCouncilResponse(text)

      expect(result).toEqual({
        has_response: true,
        response_complete: true,
        result: content,
      })
    })
  })

  describe("#given deeply nested structural tags", () => {
    it("#then preserves the same extraction result as the legacy matcher", () => {
      const text = buildNestedResponse(200)

      expect(extractCouncilResponse(text)).toEqual(legacyExtractCouncilResponse(text))
    })

    it("#then outperforms the legacy quadratic matcher on worst-case nesting", () => {
      const text = buildNestedResponse(1200)
      const iterations = 5

      const optimizedMs = measureAverageMs(() => {
        extractCouncilResponse(text)
      }, iterations)
      const legacyMs = measureAverageMs(() => {
        legacyExtractCouncilResponse(text)
      }, iterations)

      expect(optimizedMs).toBeLessThan(legacyMs / 3)
    }, 20000)
  })

})
