import { describe, it, expect } from "bun:test"
import { ATHENA_NON_INTERACTIVE_PROMPT } from "./non-interactive-prompt"

describe("ATHENA_NON_INTERACTIVE_PROMPT", () => {
  describe("#given the prompt is exported", () => {
    describe("#when checking the export type", () => {
      it("#then is exported as a string", () => {
        expect(typeof ATHENA_NON_INTERACTIVE_PROMPT).toBe("string")
      })
    })
  })

  describe("#given the identity section", () => {
    describe("#when checking for non-interactive identity", () => {
      it("#then contains identity tag with non-interactive text", () => {
        expect(ATHENA_NON_INTERACTIVE_PROMPT).toContain("<identity>")
        expect(ATHENA_NON_INTERACTIVE_PROMPT).toContain("non-interactive")
      })
    })
  })

  describe("#given the runtime_config section", () => {
    describe("#when checking for all 9 placeholder tokens", () => {
      it("#then contains NON_INTERACTIVE_MODE placeholder", () => {
        expect(ATHENA_NON_INTERACTIVE_PROMPT).toContain("{NON_INTERACTIVE_MODE}")
      })

      it("#then contains NON_INTERACTIVE_MEMBERS placeholder", () => {
        expect(ATHENA_NON_INTERACTIVE_PROMPT).toContain("{NON_INTERACTIVE_MEMBERS}")
      })

      it("#then contains NON_INTERACTIVE_MEMBER_LIST placeholder", () => {
        expect(ATHENA_NON_INTERACTIVE_PROMPT).toContain("{NON_INTERACTIVE_MEMBER_LIST}")
      })

      it("#then contains RETRY_ON_FAIL placeholder", () => {
        expect(ATHENA_NON_INTERACTIVE_PROMPT).toContain("{RETRY_ON_FAIL}")
      })

      it("#then contains RETRY_FAILED_IF_OTHERS_FINISHED placeholder", () => {
        expect(ATHENA_NON_INTERACTIVE_PROMPT).toContain("{RETRY_FAILED_IF_OTHERS_FINISHED}")
      })

      it("#then contains CANCEL_RETRYING_ON_QUORUM placeholder", () => {
        expect(ATHENA_NON_INTERACTIVE_PROMPT).toContain("{CANCEL_RETRYING_ON_QUORUM}")
      })

      it("#then contains STUCK_THRESHOLD_SECONDS placeholder", () => {
        expect(ATHENA_NON_INTERACTIVE_PROMPT).toContain("{STUCK_THRESHOLD_SECONDS}")
      })

      it("#then contains MEMBER_MAX_RUNNING_SECONDS placeholder", () => {
        expect(ATHENA_NON_INTERACTIVE_PROMPT).toContain("{MEMBER_MAX_RUNNING_SECONDS}")
      })

      it("#then contains MEMBER_WAIT_TIMEOUT_MS placeholder", () => {
        expect(ATHENA_NON_INTERACTIVE_PROMPT).toContain("{MEMBER_WAIT_TIMEOUT_MS}")
      })

      it("#then contains runtime_config section tag", () => {
        expect(ATHENA_NON_INTERACTIVE_PROMPT).toContain("<runtime_config>")
        expect(ATHENA_NON_INTERACTIVE_PROMPT).toContain("</runtime_config>")
      })
    })
  })

  describe("#given the registered_council_members section", () => {
    describe("#when checking for the section", () => {
      it("#then contains registered_council_members tag", () => {
        expect(ATHENA_NON_INTERACTIVE_PROMPT).toContain("<registered_council_members>")
        expect(ATHENA_NON_INTERACTIVE_PROMPT).toContain("</registered_council_members>")
      })
    })
  })

  describe("#given the output_contract section", () => {
    describe("#when checking for output contract structure", () => {
      it("#then contains output_contract tag with athena_council_result", () => {
        expect(ATHENA_NON_INTERACTIVE_PROMPT).toContain("<output_contract>")
        expect(ATHENA_NON_INTERACTIVE_PROMPT).toContain("<athena_council_result>")
      })

      it("#then documents discriminated failure metadata", () => {
        expect(ATHENA_NON_INTERACTIVE_PROMPT).toContain('"failure_type"')
        expect(ATHENA_NON_INTERACTIVE_PROMPT).toContain("network_error")
        expect(ATHENA_NON_INTERACTIVE_PROMPT).toContain("timeout_error")
        expect(ATHENA_NON_INTERACTIVE_PROMPT).toContain("validation_error")
        expect(ATHENA_NON_INTERACTIVE_PROMPT).toContain("quorum_error")
      })

      it("#then documents the supported status values", () => {
        expect(ATHENA_NON_INTERACTIVE_PROMPT).toContain('"status": "complete" | "partial" | "failed"')
        expect(ATHENA_NON_INTERACTIVE_PROMPT).toContain('"complete": Quorum met, synthesis performed')
        expect(ATHENA_NON_INTERACTIVE_PROMPT).toContain('"partial": Some members failed but quorum met')
        expect(ATHENA_NON_INTERACTIVE_PROMPT).toContain('"failed": Quorum not met (<2 successful members)')
      })

    })
  })

  describe("#given the constraints section", () => {
    describe("#when checking for Question tool constraint", () => {
      it("#then contains constraints tag with NEVER use the Question tool", () => {
        expect(ATHENA_NON_INTERACTIVE_PROMPT).toContain("<constraints>")
        expect(ATHENA_NON_INTERACTIVE_PROMPT).toContain("NEVER use the Question tool")
      })
    })
  })

  describe("#given the prompt is non-interactive", () => {
    describe("#when checking for forbidden interactive patterns", () => {
      it("#then does NOT contain Question tool calls", () => {
        expect(ATHENA_NON_INTERACTIVE_PROMPT).not.toContain("Question({")
      })

      it("#then does NOT contain switch_agent references", () => {
        expect(ATHENA_NON_INTERACTIVE_PROMPT).not.toContain("switch_agent")
      })
    })
  })

  describe("#given the workflow section", () => {
    describe("#when checking for all 11 steps", () => {
      it("#then contains Step 1 through Step 11", () => {
        for (let step = 1; step <= 11; step++) {
          expect(ATHENA_NON_INTERACTIVE_PROMPT).toContain(`Step ${step}:`)
        }
      })

      it("#then validates both non-interactive modes exhaustively", () => {
        expect(ATHENA_NON_INTERACTIVE_PROMPT).toContain('"delegation" -> mode: "delegation"')
        expect(ATHENA_NON_INTERACTIVE_PROMPT).toContain('"solo" -> mode: "solo"')
      })

      it("#then references structured retry and quorum outputs", () => {
        expect(ATHENA_NON_INTERACTIVE_PROMPT).toContain("retryRules")
        expect(ATHENA_NON_INTERACTIVE_PROMPT).toContain("quorumRules")
        expect(ATHENA_NON_INTERACTIVE_PROMPT).toContain("promptFile")
      })
    })
  })

  describe("#given the synthesis_rules section", () => {
    describe("#when checking for synthesis rules", () => {
      it("#then contains synthesis_rules tag", () => {
        expect(ATHENA_NON_INTERACTIVE_PROMPT).toContain("<synthesis_rules>")
        expect(ATHENA_NON_INTERACTIVE_PROMPT).toContain("</synthesis_rules>")
      })
    })
  })
})
