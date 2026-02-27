import { describe, expect, it } from "bun:test"
import { extractCouncilResponse } from "./council-response-extractor"

describe("extractCouncilResponse", () => {
  describe("#given complete COUNCIL_MEMBER_RESPONSE tags", () => {
    it("#then returns has_response true, response_complete true, and the content", () => {
      const result = extractCouncilResponse("<COUNCIL_MEMBER_RESPONSE>analysis here</COUNCIL_MEMBER_RESPONSE>")

      expect(result).toEqual({
        has_response: true,
        response_complete: true,
        result: "analysis here",
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
    it("#then returns has_response true, response_complete true, and empty string result", () => {
      const result = extractCouncilResponse("<COUNCIL_MEMBER_RESPONSE></COUNCIL_MEMBER_RESPONSE>")

      expect(result).toEqual({
        has_response: true,
        response_complete: true,
        result: "",
      })
    })
  })

  describe("#given multiple tag pairs", () => {
    it("#then returns content from the last opening tag", () => {
      const text =
        "<COUNCIL_MEMBER_RESPONSE>first analysis</COUNCIL_MEMBER_RESPONSE>\nSome interim text\n<COUNCIL_MEMBER_RESPONSE>final analysis</COUNCIL_MEMBER_RESPONSE>"
      const result = extractCouncilResponse(text)

      expect(result).toEqual({
        has_response: true,
        response_complete: true,
        result: "final analysis",
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
    it("#then returns has_response true, response_complete true, and empty string result", () => {
      const result = extractCouncilResponse("<COUNCIL_MEMBER_RESPONSE>   </COUNCIL_MEMBER_RESPONSE>")

      expect(result).toEqual({
        has_response: true,
        response_complete: true,
        result: "",
      })
    })
  })

  describe("#given content with surrounding text before the opening tag", () => {
    it("#then returns only the tagged content", () => {
      const text = "Some preamble text\n<COUNCIL_MEMBER_RESPONSE>the actual response</COUNCIL_MEMBER_RESPONSE>"
      const result = extractCouncilResponse(text)

      expect(result).toEqual({
        has_response: true,
        response_complete: true,
        result: "the actual response",
      })
    })
  })
})
