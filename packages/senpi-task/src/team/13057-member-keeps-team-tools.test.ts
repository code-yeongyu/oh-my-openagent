// #13057 review M1: a team member always runs as a process, and its agent's allow list now reaches that process as
// --tools. The member still has to report and coordinate with the task_send tool its member extension registers.
import { describe, expect, test } from "bun:test"

import { buildManagedSpec, buildRecordInput, buildRespawnManagedSpec } from "../manager/manager-helpers"
import type { ManagerStartSpec, ResolvedChildPlan } from "../manager/types"
import { personaArgs } from "../runners/rpc/persona-args"
import { createTaskRecord } from "../state"

const plan: ResolvedChildPlan = { model: "anthropic/claude", agentType: "synthetic-agent", toolAllowlist: ["read"] }

function startSpec(member: boolean): ManagerStartSpec {
  return {
    prompt: "do it",
    parent_session_id: "lead-1",
    depth: 1,
    subagent_type: "synthetic-agent",
    execution_mode: "process",
    ...(member ? { team_run_id: "run-1", team_name: "team", team_member_name: "alice", team_role: "member" } : {}),
  }
}

function launch(member: boolean) {
  const spec = startSpec(member)
  const record = {
    ...createTaskRecord(buildRecordInput({ spec, plan, name: "alice", executionMode: "process", taskSeq: 1 })),
    task_id: "st_00000001",
  }
  const first = buildManagedSpec({ record, spec, plan, cwd: "/tmp/project", stateDir: "/tmp/state" })
  return { record, first }
}

describe("a team member under an agent allow list keeps its team tools (#13057)", () => {
  test("#given a member whose agent allows only read #when it launches #then its process is started with read and task_send", () => {
    const { record, first } = launch(true)

    expect(record.tool_allow).toEqual(["read", "task_send"])
    expect(personaArgs(first)).toEqual(["--tools", "read,task_send"])
  })

  test("#given the same member #when it is respawned from its record #then it still gets task_send", () => {
    const { record } = launch(true)
    const respawn = buildRespawnManagedSpec(
      { ...record, spawn_spec: { version: 1, cwd: "/tmp/project", prompt: "do it" } },
      "/tmp/state",
    )

    expect(respawn.ok && respawn.spec.toolAllowlist).toEqual(["read", "task_send"])
  })

  test("#given a task child that is not a team member #when it launches #then its allow list is the agent's alone", () => {
    const { record, first } = launch(false)

    expect(record.tool_allow).toEqual(["read"])
    expect(personaArgs(first)).toEqual(["--tools", "read"])
  })
})
