import { describe, expect, it } from "bun:test"
import { COUNCIL_MEMBER_PROMPT } from "./council-member-agent"

describe("COUNCIL_MEMBER_PROMPT", () => {
  describe("#given the prompt constant", () => {
    describe("#when checking for required tag instructions", () => {
      it("#then contains COUNCIL_MEMBER_RESPONSE tag name", () => {
        expect(COUNCIL_MEMBER_PROMPT).toContain("COUNCIL_MEMBER_RESPONSE")
      })

      it("#then contains Response Format section header", () => {
        expect(COUNCIL_MEMBER_PROMPT).toContain("Response Format")
      })

      it("#then contains opening tag example", () => {
        expect(COUNCIL_MEMBER_PROMPT).toContain("<COUNCIL_MEMBER_RESPONSE>")
      })

      it("#then contains closing tag example", () => {
        expect(COUNCIL_MEMBER_PROMPT).toContain("</COUNCIL_MEMBER_RESPONSE>")
      })
    })
  })
})
