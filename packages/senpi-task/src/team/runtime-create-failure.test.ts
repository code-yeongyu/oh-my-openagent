import { existsSync } from "node:fs"
import { join } from "node:path"
import { afterEach, describe, expect, test } from "bun:test"

import { listActiveTeams, loadRuntimeState } from "@oh-my-opencode/team-core/team-state-store"

import { listCreateCompensations, readCreateCompensation } from "./create-compensation"
import { readMemberTaskMap } from "./member-map"
import { normalizeSenpiTeamSpec } from "./normalize"
import { SenpiTeamRuntimeError, createTeam, recoverStaleCreatingTeams } from "./runtime"
import { toTeamCoreConfig } from "./runtime-config"
import { resolveTeamRuntimeDirs, teamStorageBaseDir } from "./storage"
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
    const worktreePath = join(stateDir.project_dir, "worktrees", "alpha")
    const spec = normalizeSenpiTeamSpec(
      {
        members: [
          { name: "alpha", kind: "category", category: "quick", prompt: "a", worktreePath },
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
    expect(existsSync(worktreePath)).toBe(false)
    expect(await readMemberTaskMap(resolveTeamRuntimeDirs(stateDir, teamRunId ?? "").runtimeDir)).toEqual({
      alpha: "st_000001",
    })
  })

  test("#given compensation journaling fails #when create rollback runs #then the original error survives and creating ownership remains recoverable", async () => {
    const stateDir = stateDirConfig(tempProjectDir())
    const settings = taskSettings({ max_parallel_members: 1 })
    const manager = new FakeTeamManager({ behaviors: [{ kind: "ok" }, { kind: "throw", message: "spawn root cause" }] })
    const attempt = createTeam(normalizeSenpiTeamSpec({
      members: [
        { name: "alpha", kind: "category", category: "quick", prompt: "a" },
        { name: "beta", kind: "category", category: "deep", prompt: "b" },
      ],
    }, "journal-failure"), "project", {
      manager,
      stateDir,
      taskSettings: settings,
      leadSessionId: "lead-session",
      spawnDepth: 1,
      writeCreateCompensation: () => Promise.reject(new Error("journal unavailable")),
    })

    await expect(attempt).rejects.toThrow("spawn root cause")
    const teamRunId = manager.started[0]?.name?.split(":")[1] ?? ""
    const config = toTeamCoreConfig(settings, teamStorageBaseDir(stateDir))
    expect((await loadRuntimeState(teamRunId, config)).status).toBe("creating")
    expect(manager.get("st_000001")?.status).toBe("running")

    await recoverStaleCreatingTeams({
      manager,
      stateDir,
      taskSettings: settings,
      now: () => Date.now() + 31 * 60_000,
    })

    expect((await loadRuntimeState(teamRunId, config)).status).toBe("failed")
    expect(manager.get("st_000001")?.status).toBe("cancelled")
  })

  test("#given failed-state persistence rejects #when immediate startup recovery runs #then its retained journal completes finalization", async () => {
    const stateDir = stateDirConfig(tempProjectDir())
    const settings = taskSettings({ max_parallel_members: 1 })
    const manager = new FakeTeamManager({ behaviors: [{ kind: "ok" }, { kind: "throw", message: "initiating failure" }] })
    const attempt = createTeam(normalizeSenpiTeamSpec({
      members: [
        { name: "alpha", kind: "category", category: "quick", prompt: "a" },
        { name: "beta", kind: "category", category: "deep", prompt: "b" },
      ],
    }, "state-failure"), "project", {
      manager,
      stateDir,
      taskSettings: settings,
      leadSessionId: "lead-session",
      spawnDepth: 1,
      transitionCreateFailed: () => Promise.reject(new Error("state write failed")),
    })

    await expect(attempt).rejects.toThrow("initiating failure")
    const teamRunId = manager.started[0]?.name?.split(":")[1] ?? ""
    const config = toTeamCoreConfig(settings, teamStorageBaseDir(stateDir))
    expect((await loadRuntimeState(teamRunId, config)).status).toBe("creating")
    expect(await listCreateCompensations(stateDir)).toEqual([{ teamRunId, members: {} }])

    const recovery = await recoverStaleCreatingTeams({ manager, stateDir, taskSettings: settings })

    expect(recovery).toEqual({ markedFailed: 1, errors: [] })
    await expect(loadRuntimeState(teamRunId, config)).rejects.toMatchObject({ code: "ENOENT" })
    expect(await listCreateCompensations(stateDir)).toEqual([])
  })

  test("#given a terminal resident member #when create rollback compensates #then lifecycle destruction is verified before its journal clears", async () => {
    const stateDir = stateDirConfig(tempProjectDir())
    const settings = taskSettings({ max_parallel_members: 1 })
    const manager = new FakeTeamManager({ behaviors: [{ kind: "ok", status: "completed" }, { kind: "throw", message: "later failure" }] })
    const destroyed: string[] = []
    const attempt = createTeam(normalizeSenpiTeamSpec({
      members: [
        { name: "alpha", kind: "category", category: "quick", prompt: "a" },
        { name: "beta", kind: "category", category: "deep", prompt: "b" },
      ],
    }, "terminal-member"), "project", {
      manager,
      destruction: {
        destroyResidentTask: async (taskId) => {
          destroyed.push(taskId)
          manager.setResidency(taskId, "disposed")
        },
      },
      stateDir,
      taskSettings: settings,
      leadSessionId: "lead-session",
      spawnDepth: 1,
    })

    await expect(attempt).rejects.toThrow("later failure")
    const teamRunId = manager.started[0]?.name?.split(":")[1] ?? ""
    expect(destroyed).toEqual(["st_000001"])
    expect(manager.get("st_000001")?.residency_state).toBe("disposed")
    expect(await readCreateCompensation(stateDir, teamRunId)).toEqual({})
  })

  test("#given terminal destruction returns without changing residency #when rollback verifies cleanup #then its journal and creating state remain retryable", async () => {
    const stateDir = stateDirConfig(tempProjectDir())
    const settings = taskSettings({ max_parallel_members: 1 })
    const manager = new FakeTeamManager({ behaviors: [{ kind: "ok", status: "completed" }, { kind: "throw", message: "later failure" }] })
    const attempt = createTeam(normalizeSenpiTeamSpec({
      members: [
        { name: "alpha", kind: "category", category: "quick", prompt: "a" },
        { name: "beta", kind: "category", category: "deep", prompt: "b" },
      ],
    }, "terminal-verification"), "project", {
      manager,
      destruction: { destroyResidentTask: () => Promise.resolve() },
      stateDir,
      taskSettings: settings,
      leadSessionId: "lead-session",
      spawnDepth: 1,
    })

    await expect(attempt).rejects.toThrow("later failure")
    const teamRunId = manager.started[0]?.name?.split(":")[1] ?? ""
    const config = toTeamCoreConfig(settings, teamStorageBaseDir(stateDir))
    expect(manager.get("st_000001")?.residency_state).toBe("resident")
    expect(await readCreateCompensation(stateDir, teamRunId)).toEqual({ alpha: "st_000001" })
    expect((await loadRuntimeState(teamRunId, config)).status).toBe("creating")
  })

  test("#given rollback cancellation rejects #when member creation fails #then the original error survives and creating state remains retryable", async () => {
    // given
    const stateDir = stateDirConfig(tempProjectDir())
    const settings = taskSettings({ max_parallel_members: 1 })
    let rejectCancellation = true
    const manager = new FakeTeamManager({
      behaviors: [{ kind: "ok" }, { kind: "throw", message: "original spawn failure" }],
      beforeCancel: () => {
        if (!rejectCancellation) return Promise.resolve()
        rejectCancellation = false
        return Promise.reject(new Error("rollback cancellation failure"))
      },
    })
    const spec = normalizeSenpiTeamSpec({
      members: [
        { name: "alpha", kind: "category", category: "quick", prompt: "a" },
        { name: "beta", kind: "category", category: "deep", prompt: "b" },
      ],
    }, "squad")

    // when
    const attempt = createTeam(spec, "project", {
      manager,
      stateDir,
      taskSettings: settings,
      leadSessionId: "lead-session",
      spawnDepth: 1,
    })

    // then
    await expect(attempt).rejects.toThrow("original spawn failure")
    const teamRunId = manager.started[0]?.name?.split(":")[1] ?? ""
    const config = toTeamCoreConfig(settings, teamStorageBaseDir(stateDir))
    expect((await loadRuntimeState(teamRunId, config)).status).toBe("creating")
    expect(manager.get("st_000001")?.status).toBe("running")
    expect(await readCreateCompensation(stateDir, teamRunId)).toEqual({ alpha: "st_000001" })

    await listActiveTeams(config)
    await recoverStaleCreatingTeams({ manager, stateDir, taskSettings: settings })

    expect(manager.get("st_000001")?.status).toBe("cancelled")
    expect(await readCreateCompensation(stateDir, teamRunId)).toEqual({})
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
