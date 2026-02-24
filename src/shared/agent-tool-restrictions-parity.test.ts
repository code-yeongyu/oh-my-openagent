/**
 * Parity test: verifies Athena and council-member tool restrictions stay in sync
 * across the 3 definition surfaces.
 *
 * Surface 1: src/agents/athena/agent.ts — createAgentToolRestrictions() deny-list
 * Surface 2: src/shared/agent-tool-restrictions.ts — AGENT_RESTRICTIONS boolean map
 * Surface 3: src/agents/athena/council-member-agent.ts — createAgentToolAllowlist() array
 *
 * This test FAILS if someone adds/removes a restriction in one surface without updating the others.
 */

import { describe, expect, it } from "bun:test"
import { getAgentToolRestrictions } from "./agent-tool-restrictions"

// Surface 1: Athena deny-list from src/agents/athena/agent.ts
// createAgentToolRestrictions(["write", "edit", "call_omo_agent"])
const ATHENA_DENY_LIST = ["write", "edit", "call_omo_agent"]

// Surface 3: Council-member allowlist from src/agents/athena/council-member-agent.ts
// createAgentToolAllowlist([...])
const COUNCIL_MEMBER_ALLOWLIST = [
  "read",
  "grep",
  "glob",
  "lsp_goto_definition",
  "lsp_find_references",
  "lsp_symbols",
  "lsp_diagnostics",
  "ast_grep_search",
  "call_omo_agent",
  "background_output",
]

// Tools granted to Athena by tool-config-handler.ts (not in deny-list, not in AGENT_RESTRICTIONS)
const ATHENA_HANDLER_GRANTS = ["task", "prepare_council_prompt"]

describe("agent tool restrictions parity", () => {
  describe("given Athena restrictions", () => {
    describe("#when comparing deny-list (agent.ts) with boolean map (agent-tool-restrictions.ts)", () => {
      it("every tool in the deny-list has a matching false entry in AGENT_RESTRICTIONS", () => {
        const athenaRestrictions = getAgentToolRestrictions("athena")

        for (const tool of ATHENA_DENY_LIST) {
          expect(
            athenaRestrictions[tool],
            `Tool "${tool}" is in the deny-list (agent.ts) but not false in AGENT_RESTRICTIONS["athena"]`
          ).toBe(false)
        }
      })

      it("every false entry in AGENT_RESTRICTIONS is in the deny-list", () => {
        const athenaRestrictions = getAgentToolRestrictions("athena")
        const deniedInMap = Object.entries(athenaRestrictions)
          .filter(([, value]) => value === false)
          .map(([key]) => key)

        for (const tool of deniedInMap) {
          expect(
            ATHENA_DENY_LIST,
            `Tool "${tool}" is false in AGENT_RESTRICTIONS["athena"] but missing from deny-list (agent.ts)`
          ).toContain(tool)
        }
      })

      it("deny-list and AGENT_RESTRICTIONS false-entries have the same length", () => {
        const athenaRestrictions = getAgentToolRestrictions("athena")
        const deniedInMap = Object.entries(athenaRestrictions)
          .filter(([, value]) => value === false)
          .map(([key]) => key)

        expect(deniedInMap.length).toBe(ATHENA_DENY_LIST.length)
      })
    })

    describe("#when checking handler grants do not conflict with deny-list", () => {
      it("tools granted by tool-config-handler are NOT in the deny-list", () => {
        for (const tool of ATHENA_HANDLER_GRANTS) {
          expect(
            ATHENA_DENY_LIST,
            `Tool "${tool}" is granted by tool-config-handler but also in the deny-list — conflict!`
          ).not.toContain(tool)
        }
      })

      it("tools granted by tool-config-handler are NOT false in AGENT_RESTRICTIONS", () => {
        const athenaRestrictions = getAgentToolRestrictions("athena")

        for (const tool of ATHENA_HANDLER_GRANTS) {
          expect(
            athenaRestrictions[tool],
            `Tool "${tool}" is granted by tool-config-handler but is false in AGENT_RESTRICTIONS["athena"]`
          ).not.toBe(false)
        }
      })
    })
  })

  describe("given council-member restrictions", () => {
    describe("#when comparing allowlist (council-member-agent.ts) with boolean map (agent-tool-restrictions.ts)", () => {
      it("every tool in the allowlist has a matching true entry in AGENT_RESTRICTIONS", () => {
        const councilRestrictions = getAgentToolRestrictions("council-member")

        for (const tool of COUNCIL_MEMBER_ALLOWLIST) {
          expect(
            councilRestrictions[tool],
            `Tool "${tool}" is in the allowlist (council-member-agent.ts) but not true in AGENT_RESTRICTIONS["council-member"]`
          ).toBe(true)
        }
      })

      it("every true entry in AGENT_RESTRICTIONS is in the allowlist", () => {
        const councilRestrictions = getAgentToolRestrictions("council-member")
        const allowedInMap = Object.entries(councilRestrictions)
          .filter(([key, value]) => key !== "*" && value === true)
          .map(([key]) => key)

        for (const tool of allowedInMap) {
          expect(
            COUNCIL_MEMBER_ALLOWLIST,
            `Tool "${tool}" is true in AGENT_RESTRICTIONS["council-member"] but missing from allowlist (council-member-agent.ts)`
          ).toContain(tool)
        }
      })

      it("allowlist and AGENT_RESTRICTIONS true-entries have the same length", () => {
        const councilRestrictions = getAgentToolRestrictions("council-member")
        const allowedInMap = Object.entries(councilRestrictions)
          .filter(([key, value]) => key !== "*" && value === true)
          .map(([key]) => key)

        expect(allowedInMap.length).toBe(COUNCIL_MEMBER_ALLOWLIST.length)
      })

      it("AGENT_RESTRICTIONS has wildcard deny (*: false) for council-member", () => {
        const councilRestrictions = getAgentToolRestrictions("council-member")
        expect(councilRestrictions["*"]).toBe(false)
      })
    })
  })
})
