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

    describe("#when checking for audit bias regression", () => {
      it("#then does not contain severity (moved to AUDIT addendum)", () => {
        expect(COUNCIL_MEMBER_PROMPT).not.toContain("severity")
      })

      it("#then does not contain Search the codebase (codebase-specific)", () => {
        expect(COUNCIL_MEMBER_PROMPT).not.toContain("Search the codebase")
      })

      it("#then does not contain Focus on finding real issues (AUDIT-specific)", () => {
        expect(COUNCIL_MEMBER_PROMPT).not.toContain("Focus on finding real issues")
      })

      it("#then does not contain AUDIT-style numbered finding headers", () => {
        expect(COUNCIL_MEMBER_PROMPT).not.toMatch(/## Finding \d/)
      })

      it("#then contains evidence-based (generic analysis language)", () => {
        expect(COUNCIL_MEMBER_PROMPT).toContain("evidence-based")
      })
    })
  })
})
