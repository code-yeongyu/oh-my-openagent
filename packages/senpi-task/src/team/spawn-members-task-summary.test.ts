import { describe, expect, test } from "bun:test"

import type { ManagerStartSpec, StartResult } from "../manager"
import { normalizeSenpiTeamSpec } from "./normalize"
import type { TeamRuntimeManagerPort } from "./runtime-types"
import { spawnTeamMembers } from "./spawn-members"

function fakeManager(captured: ManagerStartSpec[]): TeamRuntimeManagerPort {
  return {
    start: async (spec: ManagerStartSpec): Promise<StartResult> => {
      captured.push(spec)
      return { kind: "started", task_id: `st_${captured.length}`, status: "running", name: spec.name ?? "member" }
    },
    cancelTask: async () => {
      throw new Error("fake TeamRuntimeManagerPort.cancelTask not configured")
    },
    get: () => undefined,
    getResidentHandle: () => undefined,
  }
}

describe("spawnTeamMembers task_summary", () => {
  test("#given a member with a task_summary #when spawned #then the manager start spec carries the summary", async () => {
    // given
    const spec = normalizeSenpiTeamSpec(
      { members: [{ kind: "category", category: "quick", prompt: "work", task_summary: "Investigate the failing test" }] },
      "demo",
    )
    const captured: ManagerStartSpec[] = []

    // when
    const result = await spawnTeamMembers({
      spec,
      teamRunId: "run-1",
      manager: fakeManager(captured),
      leadSessionId: "lead-session",
      spawnDepth: 1,
      maxParallel: 1,
      deadlineAt: Date.now() + 60_000,
      now: Date.now,
    })

    // then
    expect(result.failure).toBeUndefined()
    expect(captured[0]?.task_summary).toBe("Investigate the failing test")
  })
})
