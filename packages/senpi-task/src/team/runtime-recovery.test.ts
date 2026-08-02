import { afterEach, describe, expect, test } from "bun:test"
import { existsSync } from "node:fs"
import { mkdir } from "node:fs/promises"
import { join } from "node:path"

import {
  CREATE_CLEANUP_LEASE_TTL_MS,
  createRuntimeState,
  loadRuntimeState,
  saveRuntimeState,
} from "@oh-my-opencode/team-core/team-state-store"

import { normalizeSenpiTeamSpec } from "./normalize"
import { recoverStaleCreatingTeams } from "./runtime"
import { toTeamCoreConfig } from "./runtime-config"
import { teamStorageBaseDir } from "./storage"
import {
  FakeTeamManager,
  cleanupTeamRuntimeTmp,
  stateDirConfig,
  taskSettings,
  tempProjectDir,
} from "./__fixtures__/runtime-fakes"

afterEach(() => cleanupTeamRuntimeTmp())

describe("recoverStaleCreatingTeams", () => {
  test("#given one recovery owns cleanup #when another recovery observes pending cleanup #then only the owner performs destructive compensation", async () => {
    // given
    const projectDir = tempProjectDir()
    const stateDir = stateDirConfig(projectDir)
    const settings = taskSettings()
    const config = toTeamCoreConfig(settings, teamStorageBaseDir(stateDir))
    const worktreePath = join(projectDir, "worktrees", "alpha")
    await mkdir(worktreePath, { recursive: true })
    const spec = normalizeSenpiTeamSpec({
      members: [{ name: "alpha", kind: "category", category: "quick", prompt: "a", worktreePath }],
    }, "concurrent-recovery")
    const runtime = await createRuntimeState(spec, "lead-session", "project", config)
    await saveRuntimeState({ ...runtime, createdAt: Date.now() - 31 * 60_000 }, config)
    const firstCancellationStarted = Promise.withResolvers<void>()
    const releaseFirstCancellation = Promise.withResolvers<void>()
    let now = Date.now()
    let cancellationAttempts = 0
    const manager = new FakeTeamManager({
      beforeCancel: async () => {
        cancellationAttempts += 1
        if (cancellationAttempts !== 1) return
        firstCancellationStarted.resolve()
        await releaseFirstCancellation.promise
      },
    })
    const member = await manager.start({
      prompt: "member",
      parent_session_id: "lead-session",
      root_session_id: "lead-session",
      depth: 1,
      execution_mode: "process",
      run_in_background: true,
      category: "quick",
      name: `team:${runtime.teamRunId}:alpha`,
    })
    if (member.kind !== "started") throw new Error("fixture failed to start")

    // when
    const recoveryDeps = { manager, stateDir, taskSettings: settings, now: () => now }
    const firstRecovery = recoverStaleCreatingTeams(recoveryDeps)
    await firstCancellationStarted.promise
    now += CREATE_CLEANUP_LEASE_TTL_MS
    const secondRecovery = await recoverStaleCreatingTeams(recoveryDeps)

    // then
    expect(secondRecovery).toEqual({ markedFailed: 0, errors: [] })
    expect(cancellationAttempts).toBe(1)
    expect(existsSync(worktreePath)).toBe(true)
    releaseFirstCancellation.resolve()
    expect(await firstRecovery).toEqual({ markedFailed: 1, errors: [] })
    expect(manager.cancelled.map((entry) => entry.taskId)).toEqual([member.task_id])
    expect(existsSync(worktreePath)).toBe(false)
  })

  test("#given start committed but its sidecar write never ran #when startup recovery repeats #then the exact owned member is cancelled idempotently", async () => {
    // given
    const stateDir = stateDirConfig(tempProjectDir())
    const settings = taskSettings()
    const config = toTeamCoreConfig(settings, teamStorageBaseDir(stateDir))
    const spec = normalizeSenpiTeamSpec({
      members: [
        { name: "alpha", kind: "category", category: "quick", prompt: "a" },
        { name: "beta", kind: "category", category: "deep", prompt: "b" },
      ],
    }, "partial")
    const runtime = await createRuntimeState(spec, "lead-session", "project", config)
    await saveRuntimeState({ ...runtime, createdAt: Date.now() - 31 * 60_000 }, config)
    const manager = new FakeTeamManager()
    const member = await manager.start({
      prompt: "member",
      parent_session_id: "lead-session",
      root_session_id: "lead-session",
      depth: 1,
      execution_mode: "process",
      run_in_background: true,
      category: "quick",
      name: `team:${runtime.teamRunId}:alpha`,
    })
    const unrelated = await manager.start({
      prompt: "unrelated",
      parent_session_id: "lead-session",
      root_session_id: "lead-session",
      depth: 1,
      execution_mode: "process",
      run_in_background: true,
      category: "quick",
      name: "background-unrelated",
    })
    if (member.kind !== "started" || unrelated.kind !== "started") throw new Error("fixture failed to start")
    // when
    const first = await recoverStaleCreatingTeams({ manager, stateDir, taskSettings: settings })
    const recoveredState = await loadRuntimeState(runtime.teamRunId, config)
    const second = await recoverStaleCreatingTeams({ manager, stateDir, taskSettings: settings })

    // then
    expect(first).toEqual({ markedFailed: 1, errors: [] })
    expect(second).toEqual({ markedFailed: 0, errors: [] })
    expect(manager.cancelled.map((entry) => entry.taskId)).toEqual([member.task_id])
    expect(manager.get(unrelated.task_id)?.status).toBe("running")
    expect(recoveredState.status).toBe("failed")
  })
})
