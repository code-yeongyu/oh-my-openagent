import { afterEach, describe, expect, test } from "bun:test"

import { loadRuntimeState } from "@oh-my-opencode/team-core/team-state-store"

import type { TaskStatus } from "../state"
import { normalizeSenpiTeamSpec } from "./normalize"
import { projectMemberStatus, refreshTeamMemberStatuses, type RuntimeMemberStatus } from "./member-projection"
import { toTeamCoreConfig } from "./runtime-config"
import { createTeam } from "./runtime"
import { resolveTeamRuntimeDirs, teamStorageBaseDir } from "./storage"
import { FakeTeamManager, cleanupTeamRuntimeTmp, stateDirConfig, taskSettings, tempProjectDir } from "./__fixtures__/runtime-fakes"

afterEach(() => {
  cleanupTeamRuntimeTmp()
})

describe("projectMemberStatus", () => {
  const cases: ReadonlyArray<readonly [TaskStatus, RuntimeMemberStatus]> = [
    ["pending", "pending"],
    ["running", "running"],
    ["interrupted", "idle"],
    ["completed", "completed"],
    ["error", "errored"],
    ["cancelled", "errored"],
    ["lost", "errored"],
  ]

  for (const [taskStatus, memberStatus] of cases) {
    test(`#given task status ${taskStatus} #when projected #then member status is ${memberStatus}`, () => {
      // when / then
      expect(projectMemberStatus(taskStatus)).toBe(memberStatus)
    })
  }
})

describe("refreshTeamMemberStatuses", () => {
  test("#given a member task moved to completed #when refreshed #then the runtime member reflects completed", async () => {
    // given
    const projectDir = tempProjectDir()
    const stateDir = stateDirConfig(projectDir)
    const settings = taskSettings()
    const manager = new FakeTeamManager()
    const spec = normalizeSenpiTeamSpec(
      { members: [{ name: "alpha", kind: "category", category: "quick", prompt: "work" }] },
      "squad",
    )
    const created = await createTeam(spec, "project", {
      manager,
      stateDir,
      taskSettings: settings,
      leadSessionId: "lead-session",
      spawnDepth: 1,
    })
    const taskId = created.memberTaskIds.alpha
    manager.setStatus(taskId, "completed")

    // when
    const config = toTeamCoreConfig(settings, teamStorageBaseDir(stateDir))
    await refreshTeamMemberStatuses(created.runtimeState.teamRunId, {
      manager,
      config,
      runtimeDir: resolveTeamRuntimeDirs(stateDir, created.runtimeState.teamRunId).runtimeDir,
    })

    // then
    const reloaded = await loadRuntimeState(created.runtimeState.teamRunId, config)
    expect(reloaded.members[0]?.status).toBe("completed")
  })
})
