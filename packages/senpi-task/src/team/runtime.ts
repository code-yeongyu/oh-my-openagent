import { rm } from "node:fs/promises"

import { log } from "@oh-my-opencode/utils"
import type { RuntimeState, TeamSpec } from "@oh-my-opencode/team-core/types"
import {
  createRuntimeState,
  loadRuntimeState,
  transitionRuntimeState,
} from "@oh-my-opencode/team-core/team-state-store"

import { readMemberTaskMap, writeMemberTaskMap, type MemberTaskMap } from "./member-map"
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
import { spawnTeamMembers, type SpawnMembersResult, type SpawnedMember } from "./spawn-members"
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
 * + transition to `failed`) on the first failure or persist the member sidecar and transition to
 * `active`. The current session is always the lead sentinel; no member is ever elected lead.
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

  const result = await spawnTeamMembers({
    spec,
    teamRunId,
    manager: deps.manager,
    leadSessionId: deps.leadSessionId,
    spawnDepth: deps.spawnDepth,
    maxParallel: deps.taskSettings.team.max_parallel_members,
    deadlineAt: now() + deps.taskSettings.team.max_wall_clock_minutes * MS_PER_MINUTE,
    now,
    ...(deps.memberExtension !== undefined ? {
      memberExtension: {
        ...deps.memberExtension,
        teamConfig: JSON.stringify({
          ...config,
          stateDir: resolveStateDir(deps.stateDir),
          members: spec.members.map((member) => member.name),
          wait: deps.taskSettings.wait,
        }),
      },
    } : {}),
  })

  if (result.failure !== undefined) {
    await rollbackFailedCreate(teamRunId, result, deps, config)
    throw result.failure
  }

  const memberTaskIds = toMemberTaskMap(result.spawned)
  const writeMemberMap = deps.writeMemberMap ?? writeMemberTaskMap
  // Persist the member sidecar AFTER spawn success but BEFORE the ->active transition (W3-V F4): an
  // active team with no discoverable/cancellable members is a leak, so a write failure rolls the whole
  // create back (cancel spawned members + ->failed) instead of activating an orphaned run.
  try {
    await writeMemberMap(resolveTeamRuntimeDirs(deps.stateDir, teamRunId).runtimeDir, memberTaskIds)
  } catch (error) {
    await rollbackFailedCreate(teamRunId, result, deps, config)
    throw new SenpiTeamRuntimeError(
      `team '${spec.name}' member sidecar write failed: ${error instanceof Error ? error.message : String(error)}`,
      "sidecar_write_failed",
      spec.name,
    )
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
    const outcome = await deps.manager.cancelTask(member.taskId, `team ${teamRunId} create rollback`, deps.leadSessionId)
    if (outcome.kind !== "cancelled") {
      log("senpi-task team create rollback cancel skipped", { teamRunId, taskId: member.taskId, outcome: outcome.kind })
    }
  }
  await transitionRuntimeState(teamRunId, (state) => ({ ...state, status: "failed" }), config)
}

function toMemberTaskMap(spawned: ReadonlyMap<string, SpawnedMember>): MemberTaskMap {
  const map: Record<string, string> = {}
  for (const [name, member] of spawned) map[name] = member.taskId
  return map
}

/**
 * Deletes a team run: transition `active`/`shutdown_requested` -> `deleting`, cancel every mapped
 * member task, transition -> `deleted`, then remove the team-core runtime directory. A missing
 * runtime state is treated as an already-deleted no-op (idempotent double delete).
 */
export async function deleteTeam(teamRunId: string, deps: DeleteTeamDeps): Promise<DeleteTeamResult> {
  const config = toTeamCoreConfig(deps.taskSettings, teamStorageBaseDir(deps.stateDir))
  const runtimeDir = resolveTeamRuntimeDirs(deps.stateDir, teamRunId).runtimeDir

  const runtimeState = await loadRuntimeStateOrNull(teamRunId, config)
  if (runtimeState === null) return { teamRunId, cancelledTaskIds: [] }
  if (runtimeState.leadSessionId !== deps.callerSessionId) {
    throw new SenpiTeamRuntimeError(`session '${deps.callerSessionId}' does not own team '${teamRunId}'`, "foreign_lead", teamRunId)
  }

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
  for (const taskId of Object.values(map)) {
    const outcome = await deps.manager.cancelTask(taskId, `delete team ${teamRunId}`, deps.callerSessionId)
    if (outcome.kind === "cancelled") cancelled.push(taskId)
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
