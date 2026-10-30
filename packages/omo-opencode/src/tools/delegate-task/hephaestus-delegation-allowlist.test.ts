/**
 * Regression test for issue #6318: Hephaestus can still invoke Metis after Metis
 * is filtered out of Hephaestus's delegation table. The gpt-5-5/gpt-5-6 prompt
 * builders filter the delegation table to explore/librarian/oracle only, but the
 * task request validation path never enforced that allowlist, so a direct
 * subagent_type="metis" request still proceeded. The restriction must be enforced
 * at invocation time in validateSubagentRequest.
 */
const { describe, test, expect } = require("bun:test")

import { resolveSubagentExecution } from "./subagent-resolver"
import { HEPHAESTUS_DELEGATION_ALLOWLIST } from "./constants"
import type { ExecutorContext } from "./executor-types"

const FILTERED_AGENT_NAMES = ["metis", "momus", "multimodal-looker"]

function makeCtx(): ExecutorContext {
  return {
    client: {
      app: { agents: async () => ({ data: [] }) },
      config: { get: async () => ({ data: {} }) },
    } as unknown as ExecutorContext["client"],
    manager: {} as unknown as ExecutorContext["manager"],
    directory: "/tmp/test",
  }
}

describe("hephaestus delegation allowlist (#6318)", () => {
  for (const filteredName of FILTERED_AGENT_NAMES) {
    test(`#given parentAgent=hephaestus #when delegating to filtered agent "${filteredName}" #then it is rejected at the invocation path`, async () => {
      //#given
      const ctx = makeCtx()
      const args = {
        subagent_type: filteredName,
        prompt: "do something",
        load_skills: [],
        run_in_background: false,
        description: "test delegation",
      }

      //#when
      const result = await resolveSubagentExecution(args, ctx, "hephaestus", "")

      //#then
      expect(result.error).toBeDefined()
      expect(result.agentToUse).toBe("")
      expect(result.categoryModel).toBeUndefined()
      expect(result.error).toContain("Hephaestus")
      expect(result.error).toContain(filteredName)
    })
  }

  test("#given legacy display alias as parentAgent #when delegating to metis #then it is still rejected", async () => {
    //#given
    const ctx = makeCtx()
    const args = {
      subagent_type: "metis",
      prompt: "plan something",
      load_skills: [],
      run_in_background: false,
      description: "test delegation",
    }

    //#when
    const result = await resolveSubagentExecution(args, ctx, "Hephaestus (Deep Agent)", "")

    //#then
    expect(result.error).toBeDefined()
    expect(result.error).toContain("Hephaestus")
    expect(result.agentToUse).toBe("")
  })

  for (const allowedName of HEPHAESTUS_DELEGATION_ALLOWLIST) {
    test(`#given parentAgent=hephaestus #when delegating to allowlisted agent "${allowedName}" #then it is NOT blocked by the hephaestus guard`, async () => {
      //#given
      const ctx = makeCtx()
      const args = {
        subagent_type: allowedName,
        prompt: "search for context",
        load_skills: [],
        run_in_background: false,
        description: "test delegation",
      }

      //#when
      const result = await resolveSubagentExecution(args, ctx, "hephaestus", "")

      //#then — may fail later for unrelated reasons (empty agent registry), but NOT the hephaestus allowlist guard
      expect(result.error ?? "").not.toContain("Hephaestus")
    })
  }

  test("#given parentAgent=sisyphus #when delegating to metis #then it is NOT blocked by the hephaestus guard", async () => {
    //#given — the allowlist is scoped to Hephaestus's own invocation path; other parents keep existing behavior
    const ctx = makeCtx()
    const args = {
      subagent_type: "metis",
      prompt: "consult on a plan",
      load_skills: [],
      run_in_background: false,
      description: "test delegation",
    }

    //#when
    const result = await resolveSubagentExecution(args, ctx, "sisyphus", "")

    //#then
    expect(result.error ?? "").not.toContain("Hephaestus")
  })
})

export {}
