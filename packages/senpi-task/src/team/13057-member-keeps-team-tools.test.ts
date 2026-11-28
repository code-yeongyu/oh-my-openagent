// #13057 review M1: a team member always runs as a process, and its agent's allow list now reaches that process as
// --tools. The member still has to report and coordinate with the task_send tool its member extension registers.
import { describe, expect, test } from "bun:test"

import { buildManagedSpec, buildRecordInput, buildRespawnManagedSpec } from "../manager/manager-helpers"
import { respawnLaunchFacts } from "../manager/respawn-rpc-spec"
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

    // The record keeps the agent's own policy; the member's tools are added where it becomes a launch.
    expect(record.tool_allow).toEqual(["read"])
    expect(personaArgs(first)).toEqual(["--tools", "read,task_send"])
  })

  test("#given a member record that names only the agent's allow list #when it is respawned #then it still gets task_send", () => {
    // The shape every member record had before this rule (tool_allow is the agent's list), so an upgrade never
    // strands a resident member.
    const { record } = launch(true)
    const respawn = buildRespawnManagedSpec(
      { ...record, tool_allow: ["read"], spawn_spec: { version: 1, cwd: "/tmp/project", prompt: "do it" } },
      "/tmp/state",
    )

    expect(respawn.ok && respawn.spec.toolAllowlist).toEqual(["read", "task_send"])
  })

  test("#given a member record with no v1 spawn spec #when it is revived from the record's own policy #then it still gets task_send", () => {
    const record = { ...launch(true).record, tool_allow: ["read"] }
    const facts = respawnLaunchFacts(record, buildRespawnManagedSpec(record, "/tmp/state"), undefined)

    expect(facts.toolAllowlist).toEqual(["read", "task_send"])
  })

  test("#given a task child that is not a team member #when it launches #then its allow list is the agent's alone", () => {
    const { record, first } = launch(false)

    expect(record.tool_allow).toEqual(["read"])
    expect(personaArgs(first)).toEqual(["--tools", "read"])
  })
})
