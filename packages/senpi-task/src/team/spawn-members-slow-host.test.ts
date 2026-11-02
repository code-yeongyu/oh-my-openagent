import { describe, expect, test } from "bun:test"

import type { ManagerStartSpec, StartResult } from "../manager"
import type { TaskRecord } from "../state"
import { normalizeSenpiTeamSpec } from "./normalize"
import type { TeamRuntimeManagerPort } from "./runtime-types"
import { spawnTeamMembers } from "./spawn-members"

// A manager whose start returns `starting` (the task host is still admitting the child, #10042):
// the member's session exists only once whenLaunched has settled.
function slowHostManager(outcome: "admitted" | "refused"): TeamRuntimeManagerPort {
  let launched = false
  return {
    start: async (spec: ManagerStartSpec): Promise<StartResult> =>
      ({ kind: "started", task_id: "st_00000001", status: "running", starting: true, name: spec.name ?? "member" }),
    whenLaunched: async () => { launched = true },
    cancelTask: async () => { throw new Error("cancelTask not configured") },
    get: () => (launched
      ? ({ status: outcome === "admitted" ? "running" : "error", child_session_id: "child-session", error_message: "the task host refused the child session (open_failed)" } as unknown as TaskRecord)
      : ({ status: "running" } as unknown as TaskRecord)),
    getResidentHandle: () => undefined,
  }
}

const input = (manager: TeamRuntimeManagerPort) => ({
  spec: normalizeSenpiTeamSpec({ members: [{ kind: "category", category: "quick", prompt: "work" }] }, "demo"),
  teamRunId: "run-1",
  manager,
  leadSessionId: "lead-session",
  spawnDepth: 1,
  maxParallel: 1,
  deadlineAt: 1,
  now: () => 0,
})

describe("spawnTeamMembers against a slow task host (#10042)", () => {
  test("#given a member start the host is still admitting #when the team spawns #then the member is awaited and reports its live session", async () => {
    const run = input(slowHostManager("admitted"))
    const result = await spawnTeamMembers(run)

    expect(result.failure).toBeUndefined()
    expect(result.spawned.get(run.spec.members[0]!.name)?.sessionId).toBe("child-session")
  })

  test("#given a member start the host refuses after the window #when the team spawns #then the member start is rejected", async () => {
    const result = await spawnTeamMembers(input(slowHostManager("refused")))

    expect(result.failure?.message).toContain("failed to start")
  })
})
