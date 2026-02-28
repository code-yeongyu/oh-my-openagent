import { describe, expect, it } from "bun:test"
import { createAthenaAgent } from "./agent"

describe("Athena prompt config injection placeholders", () => {
  const athenaConfig = createAthenaAgent("anthropic/claude-opus-4-6")

  describe("#given the Athena agent prompt", () => {
    describe("#when checking for runtime injection placeholders", () => {
      it("#then contains RETRY_ON_FAIL placeholder", () => {
        expect(athenaConfig.prompt).toContain("{RETRY_ON_FAIL}")
      })

      it("#then contains STUCK_THRESHOLD_SECONDS placeholder", () => {
        expect(athenaConfig.prompt).toContain("{STUCK_THRESHOLD_SECONDS}")
      })

      it("#then contains MEMBER_MAX_RUNNING_SECONDS placeholder", () => {
        expect(athenaConfig.prompt).toContain("{MEMBER_MAX_RUNNING_SECONDS}")
      })

      it("#then contains quorum reference", () => {
        expect(athenaConfig.prompt).toContain("quorum")
      })

      it("#then contains timeout reference with 30000", () => {
        expect(athenaConfig.prompt).toContain("30000")
      })

      it("#then contains RETRY_FAILED_IF_OTHERS_FINISHED placeholder", () => {
        expect(athenaConfig.prompt).toContain("{RETRY_FAILED_IF_OTHERS_FINISHED}")
      })

      it("#then contains CANCEL_RETRYING_ON_QUORUM placeholder", () => {
        expect(athenaConfig.prompt).toContain("{CANCEL_RETRYING_ON_QUORUM}")
      })

      it("#then avoids session_id continuation retry instruction", () => {
        expect(athenaConfig.prompt).not.toContain("Retries: use task(session_id=<member_session_id>")
      })

      it("#then uses sequential workflow step numbering", () => {
        expect(athenaConfig.prompt).toContain("Step 12: Synthesize")
        expect(athenaConfig.prompt).toContain("Step 13: Determine the follow-up path")
        expect(athenaConfig.prompt).toContain("Step 14: ACTIONABLE findings")
        expect(athenaConfig.prompt).toContain("Step 15: INFORMATIONAL findings")
      })

      it("#then omits legacy mixed step labels", () => {
        expect(athenaConfig.prompt).not.toContain("Step 1.5")
        expect(athenaConfig.prompt).not.toContain("Step 4.5")
        expect(athenaConfig.prompt).not.toContain("Step 7A")
        expect(athenaConfig.prompt).not.toContain("Step 7B")
      })

      it("#then uses tagged prompt sections for consistency", () => {
        expect(athenaConfig.prompt).toContain("<identity>")
        expect(athenaConfig.prompt).toContain("<workflow>")
        expect(athenaConfig.prompt).toContain("<synthesis_rules>")
        expect(athenaConfig.prompt).toContain("<action_paths>")
        expect(athenaConfig.prompt).toContain("<constraints>")
      })

      it("#then places council setup after step 1 and removes first-action wording", () => {
        const prompt = athenaConfig.prompt ?? ""
        expect(prompt).not.toContain("CRITICAL: Council Setup (Your First Action)")

        const step1Index = prompt.indexOf("Step 1: Understand the question and decide the route.")
        const step2Index = prompt.indexOf("Step 2: Council setup (default flow before launch).")

        expect(step1Index).toBeGreaterThan(-1)
        expect(step2Index).toBeGreaterThan(step1Index)
      })

      it("#then keeps edge-case disambiguation inside step 3 classification", () => {
        const prompt = athenaConfig.prompt ?? ""
        expect(prompt).toContain("Step 3: Classify the question intent.")
        expect(prompt).toContain("Classification disambiguation rule:")
        expect(prompt).not.toContain("Before selecting a route, apply this interpretation rule")
      })

      it("#then requires question tool routing in self-answerable path", () => {
        expect(athenaConfig.prompt).toContain("Athena MUST ask the user to choose direct answer vs council using the Question tool")
        expect(athenaConfig.prompt).toContain("header: \"Routing\"")
        expect(athenaConfig.prompt).toContain("label: \"Answer directly\"")
        expect(athenaConfig.prompt).toContain("label: \"Consult council\"")
      })

      it("#then requires question tool clarifications in ambiguous council path", () => {
        expect(athenaConfig.prompt).toContain("Use the Question tool (not open-ended free text) for 1-2 targeted clarifications")
        expect(athenaConfig.prompt).toContain("Formulate the questions and options dynamically")
        expect(athenaConfig.prompt).not.toContain("header: \"Output Type\"")
        expect(athenaConfig.prompt).not.toContain("header: \"Scope\"")
      })

      it("#then keeps intent classification anchored to step 3 wording", () => {
        expect(athenaConfig.prompt).toContain("Step 3: Classify the question intent.")
        expect(athenaConfig.prompt).toContain("Then proceed to Step 2.")
        expect(athenaConfig.prompt).not.toContain("Then classify intent and proceed to Step 2.")
        expect(athenaConfig.prompt).not.toContain("Classify intent immediately and proceed to Step 2.")
      })

      it("#then excludes non-interactive mode branch from runtime prompt", () => {
        expect(athenaConfig.prompt).not.toContain("Non-interactive mode (Question tool unavailable)")
      })
    })
  })
})
