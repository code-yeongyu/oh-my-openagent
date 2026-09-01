import { existsSync } from "node:fs"
import { afterEach, describe, expect, setDefaultTimeout, test } from "bun:test"

import { createRuntimeState } from "@oh-my-opencode/team-core/team-state-store"

import { writeMemberTaskMap } from "./member-map"
import { normalizeSenpiTeamSpec } from "./normalize"
import { createTeam, deleteTeam } from "./runtime"
import { toTeamCoreConfig } from "./runtime-config"
import { resolveTeamRuntimeDirs, teamStorageBaseDir } from "./storage"
import {
  FakeDestruction,
  FakeTeamManager,
  cleanupTeamRuntimeTmp,
  stateDirConfig,
  taskSettings,
  tempProjectDir,
} from "./__fixtures__/runtime-fakes"

// bunfig preloads test-setup.ts to raise the default timeout, but Bun honours a preload's
// setDefaultTimeout only for the FIRST test file of a run; every later file silently reverts to
// the built-in 5000ms. These deletion cases create a real team under a fresh temp dir and drive
// lock-file acquisition plus concurrent cancellation/destruction, which overshoots 5s on a loaded
// windows runner (observed: 5418ms). Set the floor here, where Bun does honour it.
setDefaultTimeout(process.platform === "win32" ? 60_000 : 20_000)

afterEach(() => {
  cleanupTeamRuntimeTmp()
})

describe("deleteTeam", () => {
  async function completedResidentTeam(
    status: "running" | "completed" | "cancelled" = "completed",
    beforeCancelReturn?: (taskId: string, destruction: FakeDestruction) => Promise<void>,
  ) {
    const stateDir = stateDirConfig(tempProjectDir())
    const settings = taskSettings()
    const destruction = new FakeDestruction()
    const manager = new FakeTeamManager({
      defaultBehavior: { kind: "ok", status },
      ...(beforeCancelReturn !== undefined
        ? { beforeCancelReturn: (taskId) => beforeCancelReturn(taskId, destruction) }
        : {}),
    })
    const spec = normalizeSenpiTeamSpec(
      { members: [{ name: "alpha", kind: "category", category: "quick", prompt: "done" }] },
      "squad",
    )
    const created = await createTeam(spec, "project", {
      manager,
      stateDir,
      taskSettings: settings,
      leadSessionId: "lead-session",
      spawnDepth: 1,
    })
    const taskId = Object.values(created.memberTaskIds)[0]
    if (taskId === undefined) throw new Error("expected one mapped member task")
    const deps = { manager, destruction, stateDir, taskSettings: settings }
    return { created, deps, manager, destruction, stateDir, taskId }
  }

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
      destruction: new FakeDestruction(),
      stateDir,
      taskSettings: settings,
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
      destruction: new FakeDestruction(),
      stateDir,
      taskSettings: settings,
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
    const deps = { manager, destruction: new FakeDestruction(), stateDir, taskSettings: settings }
    await deleteTeam(created.runtimeState.teamRunId, deps)

    // when
    const second = await deleteTeam(created.runtimeState.teamRunId, deps)

    // then
    expect(second.cancelledTaskIds).toEqual([])
  })

  test("#given a completed resident member #when deleted #then cancellation stays noop while lifecycle destroys it and the runtime is removed", async () => {
    // given
    const { created, deps, manager, destruction, stateDir, taskId } = await completedResidentTeam()
    const runtimeDir = resolveTeamRuntimeDirs(stateDir, created.runtimeState.teamRunId).runtimeDir

    // when
    const result = await deleteTeam(created.runtimeState.teamRunId, deps)

    // then
    expect(manager.cancelled).toEqual([{ taskId, reason: `delete team ${created.runtimeState.teamRunId}` }])
    expect(result.cancelledTaskIds).toEqual([])
    expect(destruction.calls).toEqual([{ taskId, cause: "cancel" }])
    expect(manager.get(taskId)?.status).toBe("completed")
    expect(existsSync(runtimeDir)).toBe(false)
  })

  test("#given a member sidecar points at a foreign task #when deleted #then that task is untouched", async () => {
    // given
    const { created, deps, manager, destruction, stateDir } = await completedResidentTeam()
    const foreign = await manager.start({
      prompt: "foreign work",
      parent_session_id: "lead-session",
      depth: 1,
      name: "foreign-task",
    })
    if (foreign.kind !== "started") throw new Error("expected foreign task to start")
    const runtimeDir = resolveTeamRuntimeDirs(stateDir, created.runtimeState.teamRunId).runtimeDir
    await writeMemberTaskMap(runtimeDir, { alpha: foreign.task_id })

    // when
    const result = await deleteTeam(created.runtimeState.teamRunId, deps)

    // then
    expect(result.cancelledTaskIds).toEqual([])
    expect(manager.cancelled).toEqual([])
    expect(destruction.calls).toEqual([])
    expect(manager.get(foreign.task_id)?.status).toBe("completed")
  })

  test("#given a completed resident member already disposed #when deleted #then destruction is not repeated", async () => {
    // given
    const { created, deps, manager, destruction, taskId } = await completedResidentTeam()
    manager.setResidency(taskId, "disposed")

    // when
    const result = await deleteTeam(created.runtimeState.teamRunId, deps)

    // then
    expect(result.cancelledTaskIds).toEqual([])
    expect(destruction.calls).toEqual([])
  })

  test("#given a completed resident member revives between residency checks #when deleted #then destruction is skipped", async () => {
    // given
    const { created, deps, manager, destruction, taskId } = await completedResidentTeam()
    manager.setGetHook(taskId, (record, readCount) => (
      readCount === 3 ? { ...record, status: "running" } : record
    ))

    // when
    const result = await deleteTeam(created.runtimeState.teamRunId, deps)

    // then
    expect(result.cancelledTaskIds).toEqual([])
    expect(destruction.calls).toEqual([])
    expect(manager.get(taskId)?.status).toBe("running")
  })

  test("#given a resident member cancellation is in flight #when deleted #then deletion does not race its destruction", async () => {
    // given
    const cancellationStarted = Promise.withResolvers<void>()
    const releaseCancellation = Promise.withResolvers<void>()
    const duplicateDestructionStarted = Promise.withResolvers<void>()
    let destructionAttempts = 0
    const harness = await completedResidentTeam("running", async (taskId, destruction) => {
      destructionAttempts += 1
      await destruction.destroyResidentTask(taskId, "cancel")
      if (destructionAttempts === 1) {
        cancellationStarted.resolve()
        await releaseCancellation.promise
      } else {
        duplicateDestructionStarted.resolve()
      }
    })
    const { created, deps, manager, destruction, taskId } = harness
    const externalCancellation = manager.cancelTask(taskId, "external cancellation")
    await cancellationStarted.promise

    // when
    const deletion = deleteTeam(created.runtimeState.teamRunId, deps)
    const firstCompletion = await Promise.race([
      deletion.then(() => "delete" as const),
      duplicateDestructionStarted.promise.then(() => "duplicate-destruction" as const),
    ])
    releaseCancellation.resolve()
    const [externalOutcome, result] = await Promise.all([externalCancellation, deletion])

    // then
    expect(firstCompletion).toBe("delete")
    expect(externalOutcome.kind).toBe("cancelled")
    expect(result.cancelledTaskIds).toEqual([])
    expect(destruction.calls).toEqual([{ taskId, cause: "cancel" }])
  })

  test("#given two delete calls for one team #when invoked concurrently #then they share one cancellation and one destruction", async () => {
    // given
    const { created, deps, manager, destruction } = await completedResidentTeam()

    // when
    const [first, second] = await Promise.all([
      deleteTeam(created.runtimeState.teamRunId, deps),
      deleteTeam(created.runtimeState.teamRunId, deps),
    ])

    // then
    expect(first).toEqual(second)
    expect(manager.cancelled).toHaveLength(1)
    expect(destruction.calls).toHaveLength(1)
  })
})
