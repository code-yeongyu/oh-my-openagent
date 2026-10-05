import { afterEach, describe, expect, test } from "bun:test"

import { resolveKernelToolGrant } from "../kernel-tools/resolve"
import { fakeKernelTools } from "../runners/in-process/__fixtures__/kernel-tools-fakes"
import { createTaskRecordStore } from "../store"
import { createTaskManager } from "./manager"
import type { ManagedChildHandle } from "./child-handle"
import type { ManagedRunner, ManagedStartSpec } from "./types"
import { cleanupProjects, makeHandle, settings, tempProject } from "./__fixtures__/manager-fakes"

afterEach(() => {
  cleanupProjects()
})

async function memberGrant() {
  const capability = fakeKernelTools()
  capability.define({ name: "fixture_lookup" })
  const resolved = await resolveKernelToolGrant({ requestedNames: ["fixture_lookup"], capability, executionMode: "in-process" })
  if (resolved.kind !== "granted") throw new Error(`expected a grant, got ${resolved.kind}`)
  return { capability, grant: resolved.grant }
}

function harness() {
  const root = tempProject()
  const store = createTaskRecordStore({ project_dir: root })
  const starts: ManagedStartSpec[] = []
  const runner: ManagedRunner = {
    start: async (spec): Promise<ManagedChildHandle> => {
      starts.push(spec)
      return makeHandle(spec.taskId).handle
    },
  }
  const manager = createTaskManager({
    store,
    config: settings(),
    cwd: root,
    runners: { "in-process": runner, process: runner },
    planner: () => ({ kind: "resolved", plan: { model: "fixture/fixture" } }),
  })
  return { manager, store, starts }
}

/**
 * A team member runs out of process and can never reach a parent JavaScript kernel. The manager is
 * the floor for any caller that assembles a member spec directly, so the refusal must land before a
 * record exists - never a member spawned silently without the tools its caller believes it has.
 */
describe("team member parent kernel-tool floor", () => {
  test("#given a member spec carrying a grant #when it is started #then the spawn is refused and no record or runner start happens", async () => {
    const { manager, store, starts } = harness()
    const { grant, capability } = await memberGrant()

    const result = await manager.start({
      prompt: "member work",
      parent_session_id: "lead-session",
      depth: 1,
      team_role: "member",
      team_run_id: "tr_1",
      team_member_name: "worker",
      kernelTools: grant,
    })

    expect(result.kind).toBe("plan_unresolved")
    expect(starts).toEqual([])
    expect(store.list().records).toEqual([])
    expect(capability.invocations).toEqual([])
  })

  test("#given the same member spec without a grant #when it is started #then the member spawns normally", async () => {
    const { manager, starts } = harness()

    const result = await manager.start({
      prompt: "member work",
      parent_session_id: "lead-session",
      depth: 1,
      team_role: "member",
      team_run_id: "tr_1",
      team_member_name: "worker",
    })

    expect(result.kind).toBe("started")
    expect(starts).toHaveLength(1)
  })
})
