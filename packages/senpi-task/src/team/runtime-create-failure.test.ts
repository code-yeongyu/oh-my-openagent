import { existsSync } from "node:fs"
import { join } from "node:path"
import { afterEach, describe, expect, test } from "bun:test"

import { loadRuntimeState } from "@oh-my-opencode/team-core/team-state-store"

import { normalizeSenpiTeamSpec } from "./normalize"
import { SenpiTeamRuntimeError, createTeam } from "./runtime"
import { toTeamCoreConfig } from "./runtime-config"
import { teamStorageBaseDir } from "./storage"
import {
  FakeTeamManager,
  cleanupTeamRuntimeTmp,
  stateDirConfig,
  taskSettings,
  tempProjectDir,
} from "./__fixtures__/runtime-fakes"

afterEach(() => {
  cleanupTeamRuntimeTmp()
})

function threeMemberSpec() {
  return normalizeSenpiTeamSpec(
    {
      members: [
        { name: "alpha", kind: "category", category: "quick", prompt: "task alpha" },
        { name: "beta", kind: "category", category: "deep", prompt: "task beta" },
        { name: "gamma", kind: "subagent_type", subagent_type: "sisyphus", prompt: "task gamma" },
      ],
    },
    "squad",
  )
}

describe("createTeam failures", () => {
  test("#given a spec exceeding max_members #when created #then it is rejected before any spawn", async () => {
    // given
    const stateDir = stateDirConfig(tempProjectDir())
    const settings = taskSettings({ max_members: 2 })
    const manager = new FakeTeamManager()

    // when
    const attempt = createTeam(threeMemberSpec(), "project", {
      manager,
      stateDir,
      taskSettings: settings,
      leadSessionId: "lead-session",
      spawnDepth: 1,
    })

    // then
    await expect(attempt).rejects.toMatchObject({ code: "bounds_exceeded" })
    expect(manager.started).toHaveLength(0)
    expect(existsSync(join(teamStorageBaseDir(stateDir), "runtime"))).toBe(false)
  })

  test("#given the 2nd member spawn throws #when created #then the team fails and the 1st member is cancelled", async () => {
    // given
    const stateDir = stateDirConfig(tempProjectDir())
    const settings = taskSettings({ max_parallel_members: 1 })
    const manager = new FakeTeamManager({
      behaviors: [{ kind: "ok" }, { kind: "throw", message: "spawn boom" }],
    })
    const spec = normalizeSenpiTeamSpec(
      {
        members: [
          { name: "alpha", kind: "category", category: "quick", prompt: "a" },
          { name: "beta", kind: "category", category: "deep", prompt: "b" },
        ],
      },
      "squad",
    )

    // when
    const attempt = createTeam(spec, "project", {
      manager,
      stateDir,
      taskSettings: settings,
      leadSessionId: "lead-session",
      spawnDepth: 1,
    })

    // then
    await expect(attempt).rejects.toBeInstanceOf(SenpiTeamRuntimeError)
    expect(manager.cancelled.map((entry) => entry.taskId)).toEqual(["st_000001"])
    const config = toTeamCoreConfig(settings, teamStorageBaseDir(stateDir))
    const teamRunId = manager.started[0]?.name?.split(":")[1]
    expect(teamRunId).toBeDefined()
    const reloaded = await loadRuntimeState(teamRunId ?? "", config)
    expect(reloaded.status).toBe("failed")
  })

  test("#given the member sidecar write throws #when created #then members are cancelled, the team is failed, and it never activates", async () => {
    // given
    const stateDir = stateDirConfig(tempProjectDir())
    const settings = taskSettings()
    const manager = new FakeTeamManager()

    // when
    const attempt = createTeam(threeMemberSpec(), "project", {
      manager,
      stateDir,
      taskSettings: settings,
      leadSessionId: "lead-session",
      spawnDepth: 1,
      writeMemberMap: () => Promise.reject(new Error("disk full")),
    })

    // then
    await expect(attempt).rejects.toMatchObject({ code: "sidecar_write_failed" })
    expect(manager.cancelled.map((entry) => entry.taskId).sort()).toEqual(["st_000001", "st_000002", "st_000003"])
    const config = toTeamCoreConfig(settings, teamStorageBaseDir(stateDir))
    const teamRunId = manager.started[0]?.name?.split(":")[1] ?? ""
    const reloaded = await loadRuntimeState(teamRunId, config)
    expect(reloaded.status).toBe("failed")
  })

  test("#given a create deadline already passed #when created #then it fails with a deadline error and no spawns", async () => {
    // given
    const stateDir = stateDirConfig(tempProjectDir())
    const settings = taskSettings({ max_wall_clock_minutes: 1 })
    const manager = new FakeTeamManager()
    const clock = [1_000, 10_000_000]
    let tick = 0
    const now = () => clock[Math.min(tick++, clock.length - 1)] ?? 0

    // when
    const attempt = createTeam(threeMemberSpec(), "project", {
      manager,
      stateDir,
      taskSettings: settings,
      leadSessionId: "lead-session",
      spawnDepth: 1,
      now,
    })

    // then
    await expect(attempt).rejects.toMatchObject({ code: "create_deadline_exceeded" })
    expect(manager.started).toHaveLength(0)
  })
})
