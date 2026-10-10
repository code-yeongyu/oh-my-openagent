import { fileURLToPath } from "node:url"
import { createRuntimeState, transitionRuntimeState } from "@oh-my-opencode/team-core/team-state-store"
import type { OmoTaskSettings } from "@oh-my-opencode/omo-config-core"
import type { TaskRecordStore } from "../../store"
import { createTeamMemberRespawnLaunchResolver } from "../../team/member-respawn"
import { writeMemberTaskMap } from "../../team/member-map"
import { normalizeSenpiTeamSpec } from "../../team/normalize"
import { toTeamCoreConfig } from "../../team/runtime-config"
import { ensureTeamRuntimeDirs, teamStorageBaseDir } from "../../team/storage"

/** Seed a completed member's durable team identity; subsequent launches use the real resolver. */
export async function coldReviveTeam(store: TaskRecordStore, config: OmoTaskSettings, taskId: string) {
  const stateDir = { project_dir: store.stateDir, task: { state_dir: store.stateDir } }
  const teamConfig = toTeamCoreConfig(config, teamStorageBaseDir(stateDir))
  const spec = normalizeSenpiTeamSpec({ members: [{ name: "alpha", kind: "category", category: "quick", prompt: "fixture" }] }, "fixture-team")
  const runtime = await createRuntimeState(spec, "fixture-parent", "project", teamConfig)
  const dirs = await ensureTeamRuntimeDirs(stateDir, runtime.teamRunId, ["alpha"])
  await writeMemberTaskMap(dirs.runtimeDir, { alpha: taskId })
  await transitionRuntimeState(runtime.teamRunId, (state) => ({ ...state, status: "active" }), teamConfig)
  store.mutate(taskId, (record) => ({ ...record, name: `team:${runtime.teamRunId}:alpha`, team_run_id: runtime.teamRunId, team_name: "fixture-team", team_member_name: "alpha", team_role: "member" }))
  return createTeamMemberRespawnLaunchResolver({ stateDir, taskSettings: config,
    memberExtension: { entryPath: fileURLToPath(new URL("../../team/member-extension/index.ts", import.meta.url)) },
  })
}
