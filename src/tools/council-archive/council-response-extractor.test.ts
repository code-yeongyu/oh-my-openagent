import { describe, expect, it } from "bun:test"
import { extractCouncilResponse } from "./council-response-extractor"

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
    it("#then returns has_response false, response_complete true", () => {
      const content = "a".repeat(99)
      const result = extractCouncilResponse(`<COUNCIL_MEMBER_RESPONSE>${content}</COUNCIL_MEMBER_RESPONSE>`)

      expect(result).toEqual({
        has_response: false,
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
})

