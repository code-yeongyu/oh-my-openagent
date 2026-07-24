import { existsSync } from "node:fs"
import { stat } from "node:fs/promises"
import { join } from "node:path"
import { afterEach, describe, expect, test } from "bun:test"

import { createRuntimeState, loadRuntimeState } from "@oh-my-opencode/team-core/team-state-store"

import { readMemberTaskMap } from "./member-map"
import { normalizeSenpiTeamSpec } from "./normalize"
import { SenpiTeamRuntimeError, createTeam, deleteTeam } from "./runtime"
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

describe("createTeam", () => {
  test("#given a member extension launch config #when a team member starts #then extension and durable identity env reach the manager spec", async () => {
    // given
    const stateDir = stateDirConfig(tempProjectDir())
    const settings = taskSettings()
    const manager = new FakeTeamManager()
    const spec = normalizeSenpiTeamSpec(
      { members: [{ name: "alpha", kind: "category", category: "quick", prompt: "task alpha" }] },
      "squad",
    )

    // when
    const created = await createTeam(spec, "project", {
      manager,
      stateDir,
      taskSettings: settings,
      leadSessionId: "lead-session",
      spawnDepth: 1,
      memberExtension: {
        entryPath: "/tmp/omo-member.js",
        inheritedExtensions: ["/tmp/mock-provider.ts"],
      },
    })

    // then
    const started = manager.started[0]
    expect(started?.extensions).toEqual(["/tmp/mock-provider.ts", "/tmp/omo-member.js"])
    expect(started?.memberEnv?.["SENPI_TASK_MEMBER"]).toBe(`${created.runtimeState.teamRunId}::alpha`)
    const config = JSON.parse(started?.memberEnv?.["SENPI_TASK_TEAM_CONFIG"] ?? "null")
    expect(config).toMatchObject({
      stateDir: join(stateDir.project_dir, ".omo", "senpi-task"),
      base_dir: join(stateDir.project_dir, ".omo", "senpi-task", "teams"),
      members: ["alpha"],
      wait: settings.wait,
    })
    expect(started?.memberScopedTools).toBeUndefined()
  })

  test("#given a 3-member spec #when created #then the team is active with 3 mapped running members", async () => {
    // given
    const stateDir = stateDirConfig(tempProjectDir())
    const settings = taskSettings()
    const manager = new FakeTeamManager()

    // when
    const created = await createTeam(threeMemberSpec(), "project", {
      manager,
      stateDir,
      taskSettings: settings,
      leadSessionId: "lead-session",
      spawnDepth: 1,
    })

    // then
    expect(created.runtimeState.status).toBe("active")
    expect(created.runtimeState.members).toHaveLength(3)
    for (const member of created.runtimeState.members) {
      expect(member.status).toBe("running")
      expect(member.sessionId).toMatch(/^sess-/)
      expect(member.agentType).toBe("general-purpose")
    }
    expect(Object.keys(created.memberTaskIds).sort()).toEqual(["alpha", "beta", "gamma"])
    expect(manager.started).toHaveLength(3)
    for (const spec of manager.started) {
      expect(spec.execution_mode).toBe("process")
      expect(spec.run_in_background).toBe(true)
      expect(spec.parent_session_id).toBe("lead-session")
      expect(spec.depth).toBe(1)
      expect(spec.name).toMatch(/^team:[0-9a-f-]+:(alpha|beta|gamma)$/)
    }
  })

  test("#given roles, prompts, and a resolved model #when created #then member views carry role, model, task id, and prompt excerpt", async () => {
    // given
    const stateDir = stateDirConfig(tempProjectDir())
    const manager = new FakeTeamManager({
      behaviors: [
        {
          kind: "ok",
          resolvedModel: {
            provider: "anthropic",
            model_id: "claude-opus-4-7",
            display: "Claude Opus 4.7",
            reasoning_effort: "high",
            source: "category",
          },
        },
        { kind: "ok" },
        { kind: "ok" },
      ],
    })

    // when
    const created = await createTeam(threeMemberSpec(), "project", {
      manager,
      stateDir,
      taskSettings: taskSettings(),
      leadSessionId: "lead-session",
      spawnDepth: 1,
    })

    // then
    const [alpha, beta, gamma] = created.members
    expect(created.members).toHaveLength(3)
    expect(alpha).toMatchObject({
      name: "alpha",
      status: "running",
      role: { kind: "category", category: "quick" },
      promptExcerpt: "task alpha",
    })
    expect(alpha?.taskId).toMatch(/^st_/)
    expect(alpha?.model).toMatchObject({ provider: "anthropic", display: "Claude Opus 4.7", reasoning_effort: "high" })
    expect(beta?.model).toBeUndefined()
    expect(gamma).toMatchObject({
      name: "gamma",
      role: { kind: "subagent_type", subagentType: "sisyphus" },
      promptExcerpt: "task gamma",
    })
  })

  test("#given member prompts #when members start #then every bootstrap carries the team pull protocol before the role", async () => {
    // given
    const stateDir = stateDirConfig(tempProjectDir())
    const manager = new FakeTeamManager()
    const spec = normalizeSenpiTeamSpec(
      {
        members: [
          { name: "alpha", kind: "category", category: "quick", prompt: "task alpha" },
          { name: "beta", kind: "subagent_type", subagent_type: "sisyphus" },
        ],
      },
      "squad",
    )

    // when
    await createTeam(spec, "project", {
      manager,
      stateDir,
      taskSettings: taskSettings(),
      leadSessionId: "lead-session",
      spawnDepth: 1,
    })

    // then
    const [alphaStart, betaStart] = manager.started
    for (const start of [alphaStart, betaStart]) {
      expect(start?.prompt).toContain("team messages")
      expect(start?.prompt).toContain("team_wait")
      expect(start?.prompt).toContain("task_send")
    }
    expect(alphaStart?.prompt).toContain("'alpha'")
    expect(alphaStart?.prompt).toContain("'squad'")
    expect(alphaStart?.prompt).toContain("task alpha")
    expect(alphaStart?.prompt.indexOf("team_wait")).toBeLessThan(alphaStart?.prompt.indexOf("task alpha"))
    expect(betaStart?.prompt).toContain("'beta'")
    expect(betaStart?.prompt).toContain("'squad'")
  })

  test("#given the created team #when the sidecar is read #then it maps every member to its st_ id", async () => {
    // given
    const stateDir = stateDirConfig(tempProjectDir())
    const settings = taskSettings()
    const manager = new FakeTeamManager()
    const created = await createTeam(threeMemberSpec(), "project", {
      manager,
      stateDir,
      taskSettings: settings,
      leadSessionId: "lead-session",
      spawnDepth: 1,
    })

    // when
    const runtimeDir = resolveTeamRuntimeDirs(stateDir, created.runtimeState.teamRunId).runtimeDir
    const sidecar = await readMemberTaskMap(runtimeDir)

    // then
    expect(sidecar).toEqual(created.memberTaskIds)
    expect(Object.values(sidecar).every((id) => id.startsWith("st_"))).toBe(true)
  })

  test("#given a member with a worktreePath #when created #then the cwd is passed and the directory is made", async () => {
    // given
    const projectDir = tempProjectDir()
    const stateDir = stateDirConfig(projectDir)
    const worktreePath = join(projectDir, "wt", "alpha")
    const spec = normalizeSenpiTeamSpec(
      { members: [{ name: "alpha", kind: "category", category: "quick", prompt: "x", worktreePath }] },
      "squad",
    )
    const manager = new FakeTeamManager()

    // when
    await createTeam(spec, "project", {
      manager,
      stateDir,
      taskSettings: taskSettings(),
      leadSessionId: "lead-session",
      spawnDepth: 1,
    })

    // then
    expect(manager.started[0]?.cwd).toBe(worktreePath)
    expect((await stat(worktreePath)).isDirectory()).toBe(true)
  })

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

describe("deleteTeam", () => {
  test("#given an active team #when deleted #then all member tasks are cancelled and the runtime dir is removed", async () => {
    // given
    const stateDir = stateDirConfig(tempProjectDir())
    const settings = taskSettings()
    const manager = new FakeTeamManager()
    const spec = normalizeSenpiTeamSpec(
      {
        members: [
          { name: "alpha", kind: "category", category: "quick", prompt: "a" },
          { name: "beta", kind: "category", category: "deep", prompt: "b" },
        ],
      },
      "squad",
    )
    const created = await createTeam(spec, "project", {
      manager,
      stateDir,
      taskSettings: settings,
      leadSessionId: "lead-session",
      spawnDepth: 1,
    })
    const runtimeDir = resolveTeamRuntimeDirs(stateDir, created.runtimeState.teamRunId).runtimeDir

    // when
    const result = await deleteTeam(created.runtimeState.teamRunId, {
      manager,
      stateDir,
      taskSettings: settings,
      callerSessionId: "lead-session",
    })

    // then
    expect([...result.cancelledTaskIds].sort()).toEqual(["st_000001", "st_000002"])
    expect(manager.cancelled).toHaveLength(2)
    expect(existsSync(runtimeDir)).toBe(false)
  })

  test("#given a team still in creating #when deleted #then an invalid-state error is thrown", async () => {
    // given
    const stateDir = stateDirConfig(tempProjectDir())
    const settings = taskSettings()
    const manager = new FakeTeamManager()
    const spec = normalizeSenpiTeamSpec(
      { members: [{ name: "alpha", kind: "category", category: "quick", prompt: "a" }] },
      "squad",
    )
    const config = toTeamCoreConfig(settings, teamStorageBaseDir(stateDir))
    const seeded = await createRuntimeState(spec, "lead-session", "project", config)

    // when
    const attempt = deleteTeam(seeded.teamRunId, {
      manager,
      stateDir,
      taskSettings: settings,
      callerSessionId: "lead-session",
    })

    // then
    await expect(attempt).rejects.toMatchObject({ code: "invalid_delete_state" })
  })

  test("#given an already-deleted team #when deleted again #then it is a no-op", async () => {
    // given
    const stateDir = stateDirConfig(tempProjectDir())
    const settings = taskSettings()
    const manager = new FakeTeamManager()
    const spec = normalizeSenpiTeamSpec(
      { members: [{ name: "alpha", kind: "category", category: "quick", prompt: "a" }] },
      "squad",
    )
    const created = await createTeam(spec, "project", {
      manager,
      stateDir,
      taskSettings: settings,
      leadSessionId: "lead-session",
      spawnDepth: 1,
    })
    await deleteTeam(created.runtimeState.teamRunId, {
      manager,
      stateDir,
      taskSettings: settings,
      callerSessionId: "lead-session",
    })

    // when
    const second = await deleteTeam(created.runtimeState.teamRunId, {
      manager,
      stateDir,
      taskSettings: settings,
      callerSessionId: "lead-session",
    })

    // then
    expect(second.cancelledTaskIds).toEqual([])
  })
})
