/// <reference types="bun-types" />

import { describe, expect, it } from "bun:test"
import { ATHENA_INTERACTIVE_PROMPT } from "./interactive-prompt"

describe("ATHENA_INTERACTIVE_PROMPT", () => {
  describe("#given the interactive prompt module", () => {
    describe("#when checking the export", () => {
      it("#then exports ATHENA_INTERACTIVE_PROMPT as a string", () => {
        expect(typeof ATHENA_INTERACTIVE_PROMPT).toBe("string")
      })
    })

    describe("#when checking structural tags", () => {
      it("#then contains <identity> tag", () => {
        expect(ATHENA_INTERACTIVE_PROMPT).toContain("<identity>")
      })

      it("#then contains <workflow> tag", () => {
        expect(ATHENA_INTERACTIVE_PROMPT).toContain("<workflow>")
      })
    })

    describe("#when checking interactive-only features", () => {
      it("#then contains Question tool references", () => {
        expect(ATHENA_INTERACTIVE_PROMPT).toContain("Question tool")
      })

      it("#then contains switch_agent references", () => {
        expect(ATHENA_INTERACTIVE_PROMPT).toContain("switch_agent")
      })
    })

    describe("#when checking workflow steps", () => {
      it("#then contains Step 1: Route the message", () => {
        expect(ATHENA_INTERACTIVE_PROMPT).toContain("Step 1: Route the message")
      })

      it("#then contains Step 2: Council setup", () => {
        expect(ATHENA_INTERACTIVE_PROMPT).toContain("Step 2: Council setup")
      })
    })

    describe("#when checking non-interactive content exclusion", () => {
      it("#then does NOT contain <athena_council_result> tag", () => {
        expect(ATHENA_INTERACTIVE_PROMPT).not.toContain("<athena_council_result>")
      })
    })
  })
})
