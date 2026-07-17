import { afterEach, describe, expect, test } from "bun:test"

import { normalizeSenpiTeamSpec } from "./normalize"
import { createTeamMemberRespawnLaunchResolver } from "./member-respawn"
import { createTeam } from "./runtime"
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

describe("createTeamMemberRespawnLaunchResolver", () => {
  test("#given a persisted team member task #when resolved against current team runtime #then trusted extension and identity replace persisted launch inputs", async () => {
    // given
    const stateDir = stateDirConfig(tempProjectDir())
    const settings = taskSettings()
    const manager = new FakeTeamManager()
    const created = await createTeam(
      normalizeSenpiTeamSpec(
        { members: [{ name: "alpha", kind: "category", category: "quick", prompt: "task alpha" }] },
        "squad",
      ),
      "project",
      {
        manager,
        stateDir,
        taskSettings: settings,
        leadSessionId: "lead-session",
        spawnDepth: 1,
        memberExtension: {
          entryPath: "/trusted/member-extension.js",
          inheritedExtensions: ["/trusted/provider-extension.js"],
        },
      },
    )
    const taskId = created.memberTaskIds.alpha
    if (taskId === undefined) throw new Error("expected alpha task id")
    const record = manager.get(taskId)
    if (record === undefined) throw new Error("expected team member record")
    const persistedRecord = {
      ...record,
      spawn_spec: {
        cwd: stateDir.project_dir,
        extensions: ["/tmp/malicious-extension.ts"],
        member_env: { SENPI_TASK_MEMBER: "untrusted::member" },
      },
    }
    const resolveLaunch = createTeamMemberRespawnLaunchResolver({
      stateDir,
      taskSettings: settings,
      memberExtension: {
        entryPath: "/trusted/member-extension.js",
        inheritedExtensions: ["/trusted/provider-extension.js"],
      },
    })

    // when
    const launch = await resolveLaunch(persistedRecord)

    // then
    expect(launch?.extensions).toEqual(["/trusted/member-extension.js", "/trusted/provider-extension.js"])
    expect(launch?.memberEnv).toMatchObject({
      SENPI_TASK_MEMBER: `${created.runtimeState.teamRunId}::alpha`,
      SENPI_TASK_MEMBER_TASK_ID: taskId,
    })
    expect(launch?.memberEnv?.SENPI_TASK_TEAM_CONFIG).not.toContain("untrusted")
  })

  test("#given a team member task missing from the current task map #when resolved #then reattach is rejected", async () => {
    // given
    const stateDir = stateDirConfig(tempProjectDir())
    const settings = taskSettings()
    const manager = new FakeTeamManager()
    const created = await createTeam(
      normalizeSenpiTeamSpec(
        { members: [{ name: "alpha", kind: "category", category: "quick", prompt: "task alpha" }] },
        "squad",
      ),
      "project",
      {
        manager,
        stateDir,
        taskSettings: settings,
        leadSessionId: "lead-session",
        spawnDepth: 1,
        memberExtension: { entryPath: "/trusted/member-extension.js" },
      },
    )
    const taskId = created.memberTaskIds.alpha
    if (taskId === undefined) throw new Error("expected alpha task id")
    const record = manager.get(taskId)
    if (record === undefined) throw new Error("expected team member record")
    const resolveLaunch = createTeamMemberRespawnLaunchResolver({
      stateDir,
      taskSettings: settings,
      memberExtension: { entryPath: "/trusted/member-extension.js" },
    })

    // when / then
    await expect(resolveLaunch({ ...record, task_id: "st_999999" })).rejects.toThrow("task_mapping_mismatch")
  })
})
