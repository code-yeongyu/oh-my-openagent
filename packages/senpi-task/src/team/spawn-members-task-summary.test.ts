import { afterEach, describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { join } from "node:path"

import type { ManagerStartSpec, StartResult } from "../manager"
import { cleanupProjects, makeManager } from "../manager/__fixtures__/manager-fakes"
import { createTaskRecordStore } from "../store"
import { normalizeSenpiTeamSpec } from "./normalize"
import type { TeamRuntimeManagerPort } from "./runtime-types"
import { spawnTeamMembers } from "./spawn-members"

afterEach(cleanupProjects)

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
      deadlineAt: 1,
      now: () => 0,
    })

    // then
    expect(result.failure).toBeUndefined()
    expect(captured[0]?.task_summary).toBe("Investigate the failing test")
  })

  test("#given a team member #when the team spawn path writes its task record #then the record carries team linkage", async () => {
    // given
    const spec = normalizeSenpiTeamSpec(
      { members: [{ kind: "category", category: "quick", prompt: "work" }] },
      "demo",
    )
    const { manager, store, project } = makeManager({})

    // when
    const result = await spawnTeamMembers({
      spec,
      teamRunId: "11111111-1111-4111-8111-111111111111",
      manager,
      leadSessionId: "lead-session",
      spawnDepth: 1,
      maxParallel: 1,
      deadlineAt: 1,
      now: () => 0,
    })

    // then
    if (result.failure !== undefined) throw result.failure
    const taskId = result.spawned.get(spec.members[0]!.name)?.taskId
    expect(taskId).toBeDefined()
    const expected = {
      team_run_id: "11111111-1111-4111-8111-111111111111",
      team_name: "demo",
      team_member_name: spec.members[0]!.name,
      team_role: "member",
    }
    const persisted = JSON.parse(readFileSync(join(store.stateDir, "tasks", `${taskId}.json`), "utf8"))
    expect(persisted).toMatchObject(expected)
    expect(createTaskRecordStore({ project_dir: project }).load(taskId!)).toMatchObject(expected)
  })
})
