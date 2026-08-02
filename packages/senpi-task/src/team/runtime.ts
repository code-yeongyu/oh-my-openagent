import { rm } from "node:fs/promises"

import { log } from "@oh-my-opencode/utils"
import type { RuntimeState, TeamSpec } from "@oh-my-opencode/team-core/types"
import {
  CREATING_TIMEOUT_MS,
  createRuntimeState,
  isCreatingStateStuck,
  listActiveTeams,
  loadRuntimeState,
  markStuckCreatingTeamFailed,
  transitionRuntimeState,
} from "@oh-my-opencode/team-core/team-state-store"

import { readMemberTaskMap, writeMemberTaskMap } from "./member-map"
import { resolveStateDir } from "../store"
import type { TeamSpecSource } from "./registry"
import { toTeamCoreConfig, toTeamCoreSpecSource, type TeamCoreConfig } from "./runtime-config"
import {
  SenpiTeamRuntimeError,
  type CreateTeamDeps,
  type CreateTeamResult,
  type CreatedMemberInfo,
  type DeleteTeamDeps,
  type DeleteTeamResult,
} from "./runtime-types"
import { memberTaskName, spawnTeamMembers, type SpawnMembersResult, type SpawnedMember } from "./spawn-members"
import { ensureTeamRuntimeDirs, resolveTeamRuntimeDirs, teamStorageBaseDir } from "./storage"

const MS_PER_MINUTE = 60_000

export { SenpiTeamRuntimeError } from "./runtime-types"
export type {
  CreateTeamDeps,
  CreateTeamResult,
  CreatedMemberInfo,
  CreatedMemberRole,
  DeleteTeamDeps,
  DeleteTeamResult,
  TeamRuntimeManagerPort,
} from "./runtime-types"

/**
 * Creates a team run over the task manager: enforce the `max_members` bound BEFORE any spawn, seed
 * team-core runtime state (`creating`), spawn members as in-process background children capped by
 * `max_parallel_members` under a wall-clock deadline, then either roll back (cancel spawned members
 * + transition to `failed`) on the first failure or transition to `active`. Each successful spawn is
 * durably added to the member sidecar before creation advances, allowing crash recovery to compensate
 * only the partial team's owned tasks. The current session is always the lead sentinel.
 */
export async function createTeam(
  spec: TeamSpec,
  source: TeamSpecSource,
  deps: CreateTeamDeps,
): Promise<CreateTeamResult> {
  const maxMembers = deps.taskSettings.team.max_members
  if (spec.members.length > maxMembers) {
    throw new SenpiTeamRuntimeError(
      `team '${spec.name}' declares ${spec.members.length} members, exceeding max_members ${maxMembers}`,
      "bounds_exceeded",
      spec.name,
    )
  }

  const now = deps.now ?? Date.now
  const config = toTeamCoreConfig(deps.taskSettings, teamStorageBaseDir(deps.stateDir))
  const runtimeState = await createRuntimeState(spec, deps.leadSessionId, toTeamCoreSpecSource(source), config)
  const teamRunId = runtimeState.teamRunId
  await ensureTeamRuntimeDirs(deps.stateDir, teamRunId, spec.members.map((member) => member.name))

  const memberTaskIds: Record<string, string> = {}
  const writeMemberMap = deps.writeMemberMap ?? writeMemberTaskMap
  let sidecarWrite = Promise.resolve()
  const persistSpawnedMember = (memberName: string, member: SpawnedMember): Promise<void> => {
    memberTaskIds[memberName] = member.taskId
    const snapshot = { ...memberTaskIds }
    sidecarWrite = sidecarWrite.then(async () => {
      try {
        await writeMemberMap(resolveTeamRuntimeDirs(deps.stateDir, teamRunId).runtimeDir, snapshot)
      } catch (error) {
        throw new SenpiTeamRuntimeError(
          `team '${spec.name}' member sidecar write failed: ${error instanceof Error ? error.message : String(error)}`,
          "sidecar_write_failed",
          spec.name,
        )
      }
    })
    return sidecarWrite
  }

  const result = await spawnTeamMembers({
    spec,
    teamRunId,
    manager: deps.manager,
    leadSessionId: deps.leadSessionId,
    spawnDepth: deps.spawnDepth,
    maxParallel: deps.taskSettings.team.max_parallel_members,
    deadlineAt: now() + deps.taskSettings.team.max_wall_clock_minutes * MS_PER_MINUTE,
    now,
    onMemberSpawned: persistSpawnedMember,
    ...(deps.memberExtension !== undefined ? {
      memberExtension: {
        ...deps.memberExtension,
        teamConfig: JSON.stringify({
          ...config,
          stateDir: resolveStateDir(deps.stateDir),
          members: spec.members.map((member) => member.name),
        }),
      },
    } : {}),
  })

  if (result.failure !== undefined) {
    await rollbackFailedCreate(teamRunId, result, deps, config)
    throw result.failure
  }

  const activated = await activateTeam(teamRunId, result.spawned, config)
  return { runtimeState: activated, memberTaskIds, members: toCreatedMemberInfos(spec, result.spawned, activated) }
}

const PROMPT_EXCERPT_MAX = 120

function excerptPrompt(prompt: string): string {
  const collapsed = prompt.replace(/\s+/g, " ").trim()
  return collapsed.length <= PROMPT_EXCERPT_MAX ? collapsed : `${collapsed.slice(0, PROMPT_EXCERPT_MAX)}...`
}

// Builds the caller-facing per-member views from the spec (role, prompt), the spawn outcomes (task
// id, resolved model), and the activated runtime state (live status). Spawn success guarantees every
// spec member has an outcome; a member missing from the map is skipped defensively.
function toCreatedMemberInfos(
  spec: TeamSpec,
  spawned: ReadonlyMap<string, SpawnedMember>,
  state: RuntimeState,
): CreatedMemberInfo[] {
  return spec.members.flatMap((member) => {
    const outcome = spawned.get(member.name)
    if (outcome === undefined) return []
    const stateMember = state.members.find((candidate) => candidate.name === member.name)
    return [{
      name: member.name,
      taskId: outcome.taskId,
      status: stateMember?.status ?? outcome.status,
      role: member.kind === "category"
        ? { kind: "category", category: member.category }
        : { kind: "subagent_type", subagentType: member.subagent_type },
      ...(outcome.resolvedModel !== undefined ? { model: outcome.resolvedModel } : {}),
      ...(member.prompt !== undefined ? { promptExcerpt: excerptPrompt(member.prompt) } : {}),
      ...(member.task_summary !== undefined ? { taskSummary: member.task_summary } : {}),
    }]
  })
}

async function activateTeam(
  teamRunId: string,
  spawned: ReadonlyMap<string, SpawnedMember>,
  config: TeamCoreConfig,
): Promise<RuntimeState> {
  await transitionRuntimeState(
    teamRunId,
    (state) => ({
      ...state,
      members: state.members.map((member) => {
        const outcome = spawned.get(member.name)
        if (outcome === undefined) return member
        return { ...member, status: outcome.status, ...(outcome.sessionId !== undefined ? { sessionId: outcome.sessionId } : {}) }
      }),
    }),
    config,
  )
  return transitionRuntimeState(teamRunId, (state) => ({ ...state, status: "active" }), config)
}

async function rollbackFailedCreate(
  teamRunId: string,
  result: SpawnMembersResult,
  deps: CreateTeamDeps,
  config: TeamCoreConfig,
): Promise<void> {
  for (const member of result.spawned.values()) {
    try {
      const outcome = await deps.manager.cancelTask(member.taskId, `team ${teamRunId} create rollback`)
      if (outcome.kind !== "cancelled") {
        log("senpi-task team create rollback cancel skipped", { teamRunId, taskId: member.taskId, outcome: outcome.kind })
      }
    } catch (error) {
      log("senpi-task team create rollback cancel failed", {
        teamRunId,
        taskId: member.taskId,
        error: error instanceof Error ? error.message : String(error),
      })
    }
  }
  await transitionRuntimeState(teamRunId, (state) => ({ ...state, status: "failed" }), config)
}

export type RecoverStaleCreatingTeamsResult = {
  readonly markedFailed: number
  readonly errors: readonly Error[]
}

export async function recoverStaleCreatingTeams(
  deps: Pick<CreateTeamDeps, "manager" | "stateDir" | "taskSettings" | "now">,
): Promise<RecoverStaleCreatingTeamsResult> {
  const config = toTeamCoreConfig(deps.taskSettings, teamStorageBaseDir(deps.stateDir))
  const activeTeams = await listActiveTeams(config)
  const errors: Error[] = []
  let markedFailed = 0

  for (const team of activeTeams) {
    try {
      const runtimeState = await loadRuntimeState(team.teamRunId, config)
      if (!isCreatingStateStuck(runtimeState, (deps.now ?? Date.now)(), CREATING_TIMEOUT_MS)) continue
      const runtimeDir = resolveTeamRuntimeDirs(deps.stateDir, team.teamRunId).runtimeDir
      const memberMap = await readMemberTaskMap(runtimeDir)
      for (const [memberName, taskId] of Object.entries(memberMap)) {
        if (deps.manager.get(taskId)?.name !== memberTaskName(team.teamRunId, memberName)) continue
        try {
          await deps.manager.cancelTask(taskId, `team ${team.teamRunId} stale create recovery`)
        } catch (error) {
          log("senpi-task stale team create cancel failed", {
            teamRunId: team.teamRunId,
            taskId,
            error: error instanceof Error ? error.message : String(error),
          })
        }
      }
      await markStuckCreatingTeamFailed(runtimeState, config)
      markedFailed += 1
    } catch (error) {
      errors.push(error instanceof Error ? error : new Error(String(error)))
    }
  }

  return { markedFailed, errors }
}

/**
 * Deletes a team run: transition `active`/`shutdown_requested` -> `deleting`, cancel every mapped
 * member task, transition -> `deleted`, then remove the team-core runtime directory. A missing
 * runtime state is treated as an already-deleted no-op (idempotent double delete).
 *
 * Same-process calls for one team coalesce onto a single in-flight operation: an uncoordinated
 * second delete can crash on the removed runtime directory or tear down the same resident twice,
 * so concurrent callers share one promise keyed by the resolved runtime directory.
 */
const deleteOperations = new Map<string, Promise<DeleteTeamResult>>()

export function deleteTeam(teamRunId: string, deps: DeleteTeamDeps): Promise<DeleteTeamResult> {
  const key = resolveTeamRuntimeDirs(deps.stateDir, teamRunId).runtimeDir
  const current = deleteOperations.get(key)
  if (current !== undefined) return current
  const operation = performDeleteTeam(teamRunId, deps).finally(() => deleteOperations.delete(key))
  deleteOperations.set(key, operation)
  return operation
}

async function performDeleteTeam(teamRunId: string, deps: DeleteTeamDeps): Promise<DeleteTeamResult> {
  const config = toTeamCoreConfig(deps.taskSettings, teamStorageBaseDir(deps.stateDir))
  const runtimeDir = resolveTeamRuntimeDirs(deps.stateDir, teamRunId).runtimeDir

  const runtimeState = await loadRuntimeStateOrNull(teamRunId, config)
  if (runtimeState === null) return { teamRunId, cancelledTaskIds: [] }

  if (runtimeState.status === "active" || runtimeState.status === "shutdown_requested") {
    await transitionRuntimeState(teamRunId, (state) => ({ ...state, status: "deleting" }), config)
  } else if (runtimeState.status !== "deleting" && runtimeState.status !== "deleted") {
    throw new SenpiTeamRuntimeError(
      `team '${teamRunId}' cannot be deleted from status '${runtimeState.status}'`,
      "invalid_delete_state",
      teamRunId,
    )
  }

  const cancelledTaskIds = await cancelMemberTasks(teamRunId, runtimeDir, deps)

  if (runtimeState.status !== "deleted") {
    await transitionRuntimeState(teamRunId, (state) => (state.status === "deleted" ? state : { ...state, status: "deleted" }), config)
  }
  await rm(runtimeDir, { recursive: true, force: true })
  return { teamRunId, cancelledTaskIds }
}

async function cancelMemberTasks(teamRunId: string, runtimeDir: string, deps: DeleteTeamDeps): Promise<string[]> {
  const map = await readMemberTaskMap(runtimeDir)
  const cancelled: string[] = []
  for (const [memberName, taskId] of Object.entries(map)) {
    if (deps.manager.get(taskId)?.name !== memberTaskName(teamRunId, memberName)) continue
    const outcome = await deps.manager.cancelTask(taskId, `delete team ${teamRunId}`)
    if (outcome.kind === "cancelled") {
      cancelled.push(taskId)
      continue
    }
    // Terminal cancellation is an intentional noop (completed residents stay revivable), but team
    // deletion owns member teardown: route the resident through the lifecycle single-writer port.
    // A `cancelled` noop means an in-flight cancellation already owns destruction, and a
    // non-resident record has nothing left to tear down, so neither path may destroy again. Re-read
    // immediately before destruction so a revive between the noop and residency checks wins; a
    // narrower revive window remains after this final read and is serialized by lifecycle teardown.
    const observed = deps.manager.get(taskId)
    if (outcome.kind === "noop" && outcome.status !== "cancelled" && observed?.residency_state === "resident") {
      const current = deps.manager.get(taskId)
      if (
        current !== undefined
        && current.status !== "pending"
        && current.status !== "running"
        && current.residency_state === "resident"
      ) {
        await deps.destruction.destroyResidentTask(taskId, "cancel")
      }
    }
  }
  return cancelled
}

async function loadRuntimeStateOrNull(teamRunId: string, config: TeamCoreConfig): Promise<RuntimeState | null> {
  try {
    return await loadRuntimeState(teamRunId, config)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null
    throw error
  }
}
