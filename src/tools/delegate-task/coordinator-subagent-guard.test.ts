/**
 * Regression test for issue #4027: coordinator agents must not be selectable as
 * subagent targets via task(). Symmetric guard to PR #4065 (team_create caller
 * eligibility) — this covers the TARGET side of delegation.
 */
const { describe, test, expect } = require("bun:test")

import { resolveSubagentExecution } from "./subagent-resolver"
import { COORDINATOR_AGENT_NAMES } from "./constants"
import type { ExecutorContext } from "./executor-types"

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

describe("coordinator subagent guard (#4027)", () => {
  for (const coordinatorName of COORDINATOR_AGENT_NAMES) {
    test(`#given subagent_type="${coordinatorName}" #when resolveSubagentExecution is called #then it is rejected before spawning`, async () => {
      //#given
      const ctx = makeCtx()
      const args = {
        subagent_type: coordinatorName,
        prompt: "do something",
        load_skills: [],
        run_in_background: false,
      }

      //#when
      const result = await resolveSubagentExecution(args, ctx, "sisyphus", "")

      //#then
      expect(result.error).toBeDefined()
      expect(result.agentToUse).toBe("")
      expect(result.error).toContain(coordinatorName)
      expect(result.error).toContain("coordinator agent")
    })
  }

  test("#given subagent_type=prometheus #when resolveSubagentExecution is called #then error names the agent and explains the conflict", async () => {
    //#given
    const ctx = makeCtx()
    const args = {
      subagent_type: "prometheus",
      prompt: "plan something",
      load_skills: [],
      run_in_background: false,
    }

    //#when
    const result = await resolveSubagentExecution(args, ctx, "sisyphus", "")

    //#then
    expect(result.error).toContain("prometheus")
    expect(result.error).toContain("coordinator")
    expect(result.error).toContain("duplicate")
    expect(result.agentToUse).toBe("")
    expect(result.categoryModel).toBeUndefined()
  })

  test("#given subagent_type=hephaestus #when resolveSubagentExecution is called #then it is not blocked by coordinator guard", async () => {
    //#given
    const ctx = makeCtx()
    const args = {
      subagent_type: "hephaestus",
      prompt: "write some code",
      load_skills: [],
      run_in_background: false,
    }

    //#when
    const result = await resolveSubagentExecution(args, ctx, "sisyphus", "")

    //#then — hephaestus may fail for other reasons (API call), but NOT the coordinator guard
    expect(result.error).not.toContain("coordinator agent")
  })
})

export {}
