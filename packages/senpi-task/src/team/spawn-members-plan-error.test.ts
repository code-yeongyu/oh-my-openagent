import { describe, expect, test } from "bun:test"

import type { ManagerStartSpec, PlanResolutionError, StartResult } from "../manager"
import { normalizeSenpiTeamSpec } from "./normalize"
import type { TeamRuntimeManagerPort } from "./runtime-types"
import { spawnTeamMembers } from "./spawn-members"

function planUnresolvedManager(error: PlanResolutionError): TeamRuntimeManagerPort {
  return {
    start: async (_spec: ManagerStartSpec): Promise<StartResult> => ({ kind: "plan_unresolved", error }),
    cancelTask: async () => {
      throw new Error("fake TeamRuntimeManagerPort.cancelTask not configured")
    },
    get: () => undefined,
    getResidentHandle: () => undefined,
  }
}

async function failureMessage(error: PlanResolutionError): Promise<string> {
  const spec = normalizeSenpiTeamSpec({ members: [{ name: "bench-landscape", kind: "category", category: "deep", prompt: "work" }] }, "bench")
  const result = await spawnTeamMembers({
    spec,
    teamRunId: "run-1",
    manager: planUnresolvedManager(error),
    leadSessionId: "lead-session",
    spawnDepth: 1,
    maxParallel: 1,
    deadlineAt: 1,
    now: () => 0,
  })
  if (result.failure === undefined) throw new Error("expected a spawn failure")
  return result.failure.message
}

describe("spawnTeamMembers plan errors", () => {
  test("#given a model_unavailable category #when the member start is unresolved #then the failure lists the valid category names", async () => {
    const message = await failureMessage({
      code: "model_unavailable",
      message: 'No available model for category "deep" (attempted mock/model).',
      availableCategories: ["quick", "unspecified-low"],
    })

    expect(message).toContain("member 'bench-landscape' failed to start")
    expect(message).toContain('No available model for category "deep"')
    expect(message).toContain("Valid category names: quick, unspecified-low.")
  })

  test("#given an unknown_target error carrying agents and categories #when the member start is unresolved #then both lists are offered without the model-unavailable retry hint", async () => {
    const message = await failureMessage({
      code: "unknown_target",
      message: 'Unknown category "deap".',
      availableAgents: ["explore"],
      availableCategories: ["quick", "deep"],
    })

    expect(message).toContain("Available agents: explore.")
    expect(message).toContain("Available categories: quick, deep.")
    expect(message).not.toContain("Valid category names")
  })

  test("#given a plan error with no available lists #when the member start is unresolved #then only the planner message is reported", async () => {
    const message = await failureMessage({ code: "category_disabled", message: 'Category "deep" is disabled.' })

    expect(message).toBe("member 'bench-landscape' failed to start: Category \"deep\" is disabled.")
  })
})
