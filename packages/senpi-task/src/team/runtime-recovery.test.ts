import { afterEach, describe, expect, test } from "bun:test"

import { createRuntimeState, loadRuntimeState, saveRuntimeState } from "@oh-my-opencode/team-core/team-state-store"

import { writeMemberTaskMap } from "./member-map"
import { normalizeSenpiTeamSpec } from "./normalize"
import { recoverStaleCreatingTeams } from "./runtime"
import { toTeamCoreConfig } from "./runtime-config"
import { resolveTeamRuntimeDirs, teamStorageBaseDir } from "./storage"
import {
  FakeTeamManager,
  cleanupTeamRuntimeTmp,
  stateDirConfig,
  taskSettings,
  tempProjectDir,
} from "./__fixtures__/runtime-fakes"

afterEach(() => cleanupTeamRuntimeTmp())

describe("recoverStaleCreatingTeams", () => {
  test("#given a stale partial create #when startup recovery repeats #then only mapped members are cancelled and failure is idempotent", async () => {
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
    await writeMemberTaskMap(resolveTeamRuntimeDirs(stateDir, runtime.teamRunId).runtimeDir, { alpha: member.task_id })

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
