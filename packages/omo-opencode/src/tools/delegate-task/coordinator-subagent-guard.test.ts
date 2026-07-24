/// <reference types="bun-types" />

/**
 * Regression test for issue #4027: coordinator agents must not be selectable as
 * subagent targets via task(). Symmetric guard to PR #4065 (team_create caller
 * eligibility) — this covers the TARGET side of delegation.
 */
import { describe, expect, test } from "bun:test"

import { resolveSubagentExecution } from "./subagent-resolver"
import { COORDINATOR_AGENT_NAMES } from "./constants"
import type { AgentInfo } from "./subagent-discovery"
import type { ExecutorContext } from "./executor-types"
import type { OpencodeClient } from "./types"

function makeCtx(agents: AgentInfo[] = []): ExecutorContext {
  const client: OpencodeClient = {
    app: { agents: async () => ({ data: agents }) },
    config: { get: async () => ({ data: {} }) },
    session: {
      abort: async () => ({}),
      create: async () => ({ data: { id: "unused" } }),
      get: async () => ({ data: {} }),
      messages: async () => ({ data: [] }),
      status: async () => ({ data: {} }),
    },
  }

  return {
    client,
    manager: {} as ExecutorContext["manager"],
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
        description: "test delegation",
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
      description: "test delegation",
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
      description: "test delegation",
    }

    //#when
    const result = await resolveSubagentExecution(args, ctx, "sisyphus", "")

    //#then — hephaestus may fail for other reasons (API call), but NOT the coordinator guard
    expect(result.error).not.toContain("coordinator agent")
  })

  test("#given subagent_type=sisyphus #when resolveSubagentExecution is called #then sisyphus is NOT blocked by coordinator guard (registry: eligible)", async () => {
    //#given — sisyphus is verdict:'eligible' in AGENT_ELIGIBILITY_REGISTRY; it must not be rejected by the coordinator guard
    const ctx = makeCtx()
    const args = {
      subagent_type: "sisyphus",
      prompt: "do team-mode work",
      load_skills: [],
      run_in_background: false,
      description: "test delegation",
    }

    //#when
    const result = await resolveSubagentExecution(args, ctx, "sisyphus", "")

    //#then — sisyphus may fail for primary-agent reasons (separate guard), but NOT the coordinator guard
    expect(result.error).not.toContain("coordinator agent")
  })

  test("#given subagent_type=atlas #when resolveSubagentExecution is called #then atlas is NOT blocked by coordinator guard (registry: eligible)", async () => {
    //#given — atlas is verdict:'eligible' in AGENT_ELIGIBILITY_REGISTRY; it must not be rejected by the coordinator guard
    const ctx = makeCtx()
    const args = {
      subagent_type: "atlas",
      prompt: "do team-mode work",
      load_skills: [],
      run_in_background: false,
      description: "test delegation",
    }

    //#when
    const result = await resolveSubagentExecution(args, ctx, "sisyphus", "")

    //#then — atlas may fail for primary-agent reasons (separate guard), but NOT the coordinator guard
    expect(result.error).not.toContain("coordinator agent")
  })

  test("#given subagent_type=prometheus AND allowPrimaryAgentDelegation=true #when resolveSubagentExecution is called #then prometheus is STILL rejected (registry hard-reject is authoritative)", async () => {
    //#given — prometheus is verdict:'hard-reject' in AGENT_ELIGIBILITY_REGISTRY; the coordinator guard must fire even when the team-mode resolver opts into primary-agent delegation
    const ctx = makeCtx()
    const args = {
      subagent_type: "prometheus",
      prompt: "plan something",
      load_skills: [],
      run_in_background: false,
      description: "test delegation",
    }

    //#when
    const result = await resolveSubagentExecution(args, ctx, "sisyphus", "", { allowPrimaryAgentDelegation: true })

    //#then
    expect(result.error).toContain("prometheus")
    expect(result.error).toContain("coordinator agent")
    expect(result.agentToUse).toBe("")
  })

  test("#given subagent_type=plan resolves to a hidden demoted plan #when resolveSubagentExecution is called from a worker #then the coordinator lane is rejected", async () => {
    //#given
    const ctx = makeCtx([{ name: "plan", mode: "subagent", hidden: true }])
    const args = {
      subagent_type: "plan",
      prompt: "plan something",
      load_skills: [],
      run_in_background: false,
      description: "test delegation",
    }

    //#when
    const result = await resolveSubagentExecution(args, ctx, "hephaestus", "")

    //#then
    expect(result.error).toContain("plan")
    expect(result.error).toContain("coordinator agent")
    expect(result.error).toContain("Prometheus")
    expect(result.agentToUse).toBe("")
  })

  test("#given subagent_type=plan resolves to a visible custom subagent #when resolveSubagentExecution is called from a worker #then the coordinator guard does not reject it", async () => {
    //#given
    const ctx = makeCtx([{ name: "plan", mode: "subagent" }])
    const args = {
      subagent_type: "plan",
      prompt: "plan something",
      load_skills: [],
      run_in_background: false,
      description: "test delegation",
    }

    //#when
    const result = await resolveSubagentExecution(args, ctx, "hephaestus", "")

    //#then
    expect(result.error).toBeUndefined()
    expect(result.agentToUse).toBe("plan")
  })
})

export {}
