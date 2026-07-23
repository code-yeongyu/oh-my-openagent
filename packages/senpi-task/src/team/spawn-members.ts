import { mkdir } from "node:fs/promises"

import type { TeamSpec } from "@oh-my-opencode/team-core/types"

import type { ManagerStartSpec, StartResult } from "../manager"
import type { ResolvedModelRecord } from "../state"
import { projectMemberStatus, type RuntimeMemberStatus } from "./member-projection"
import {
  SenpiTeamRuntimeError,
  type SpawnMemberExtensionConfig,
  type TeamRuntimeManagerPort,
} from "./runtime-types"

type TeamMember = TeamSpec["members"][number]

export type SpawnedMember = {
  readonly taskId: string
  readonly sessionId?: string
  readonly status: RuntimeMemberStatus
  readonly resolvedModel?: ResolvedModelRecord
}

export type SpawnMembersInput = {
  readonly spec: TeamSpec
  readonly teamRunId: string
  readonly manager: TeamRuntimeManagerPort
  readonly leadSessionId: string
  readonly spawnDepth: number
  readonly maxParallel: number
  readonly deadlineAt: number
  readonly now: () => number
  readonly memberExtension?: SpawnMemberExtensionConfig
}

export type SpawnMembersResult = {
  readonly spawned: ReadonlyMap<string, SpawnedMember>
  readonly failure?: Error
}

export function memberTaskName(teamRunId: string, memberName: string): string {
  return `team:${teamRunId}:${memberName}`
}

/**
 * Spawns team members as senpi-task children through the manager, capped at `maxParallel` cooperating
 * workers over a shared index, enforcing the create deadline before each pull. Members run as durable
 * background processes so their sessions remain recoverable across parent or child crashes. The FIRST
 * failure (a rejected start, a thrown start, or a deadline breach) flips the shared flag so the remaining
 * workers drain out and the caller rolls back the members already spawned.
 */
export async function spawnTeamMembers(input: SpawnMembersInput): Promise<SpawnMembersResult> {
  const spawned = new Map<string, SpawnedMember>()
  let failure: Error | undefined
  let nextIndex = 0
  const workerCount = Math.max(1, Math.min(input.maxParallel, input.spec.members.length))

  const runWorker = async (): Promise<void> => {
    while (failure === undefined) {
      if (input.now() > input.deadlineAt) {
        failure = new SenpiTeamRuntimeError(
          `team '${input.spec.name}' creation exceeded max_wall_clock_minutes`,
          "create_deadline_exceeded",
          input.teamRunId,
        )
        return
      }
      const member = input.spec.members[nextIndex++]
      if (member === undefined) return
      try {
        spawned.set(member.name, await spawnOneMember(input, member))
      } catch (error) {
        failure = toSpawnFailure(input.teamRunId, member.name, error)
        return
      }
    }
  }

  await Promise.all(Array.from({ length: workerCount }, runWorker))
  return failure !== undefined ? { spawned, failure } : { spawned }
}

// Normalizes any spawn failure into the typed team runtime error. A start that already threw the
// typed error (a rejected StartResult) passes through; a raw throw from the manager is wrapped with
// its original message preserved as the cause so callers always see a SenpiTeamRuntimeError.
function toSpawnFailure(teamRunId: string, memberName: string, error: unknown): SenpiTeamRuntimeError {
  if (error instanceof SenpiTeamRuntimeError) return error
  const wrapped = new SenpiTeamRuntimeError(
    `member '${memberName}' failed to start: ${error instanceof Error ? error.message : String(error)}`,
    "member_start_rejected",
    teamRunId,
  )
  wrapped.cause = error
  return wrapped
}

async function spawnOneMember(input: SpawnMembersInput, member: TeamMember): Promise<SpawnedMember> {
  if (member.worktreePath !== undefined) await mkdir(member.worktreePath, { recursive: true })

  const result = await input.manager.start(buildMemberStartSpec(input, member))
  if (result.kind !== "started") {
    throw new SenpiTeamRuntimeError(
      `member '${member.name}' failed to start: ${describeStartResult(result)}`,
      "member_start_rejected",
      input.teamRunId,
    )
  }

  const record = input.manager.get(result.task_id)
  const sessionId = input.manager.getResidentHandle(result.task_id)?.sessionId ?? record?.child_session_id
  const status = projectMemberStatus(record?.status ?? (result.status === "pending" ? "pending" : "running"))
  const resolvedModel = result.resolved_model ?? record?.resolved_model
  return {
    taskId: result.task_id,
    ...(sessionId !== undefined ? { sessionId } : {}),
    status,
    ...(resolvedModel !== undefined ? { resolvedModel } : {}),
  }
}

function buildMemberStartSpec(input: SpawnMembersInput, member: TeamMember): ManagerStartSpec {
  const launch = input.memberExtension
  const extensions = launch === undefined
    ? undefined
    : [...new Set([...(launch.inheritedExtensions ?? []), launch.entryPath])]
  return {
    prompt: buildMemberPrompt(input.spec, member),
    parent_session_id: input.leadSessionId,
    root_session_id: input.leadSessionId,
    depth: input.spawnDepth,
    name: memberTaskName(input.teamRunId, member.name),
    execution_mode: "process",
    run_in_background: true,
    ...(member.kind === "category" ? { category: member.category } : { subagent_type: member.subagent_type }),
    ...(member.worktreePath !== undefined ? { cwd: member.worktreePath } : {}),
    ...(extensions !== undefined ? { extensions } : {}),
    ...(launch !== undefined ? {
      memberEnv: {
        SENPI_TASK_MEMBER: `${input.teamRunId}::${member.name}`,
        SENPI_TASK_TEAM_CONFIG: launch.teamConfig,
      },
    } : {}),
  }
}

// Every member bootstrap frames the pull protocol FIRST so members wait for work instead of
// completing after the role prompt: role-only bootstraps historically completed in under two
// minutes and left the lead's first task messages rotting in durable inboxes.
function buildMemberPrompt(spec: TeamSpec, member: TeamMember): string {
  const role = member.prompt ?? `You are team member '${member.name}' in team '${spec.name}'.`
  return [
    `You are '${member.name}', a member of team '${spec.name}' running under the senpi-task team runtime.`,
    "Work arrives as team messages from the lead and the other members; coordinate with the task_send and team_wait tools.",
    "After completing any immediate instructions below, call team_wait to receive work instead of ending your turn, and keep going until the lead releases you.",
    "When you finish assigned work, task_send the lead a summary before returning to team_wait.",
    role,
  ].join("\n\n")
}

function describeStartResult(result: Exclude<StartResult, { kind: "started" }>): string {
  switch (result.kind) {
    case "depth_denied":
      return result.reason
    case "plan_unresolved":
      return result.error.message
    case "start_failed":
      return result.error_message
    case "residency_denied":
      return result.reason
    default:
      return assertNever(result)
  }
}

function assertNever(value: never): never {
  throw new Error(`unexpected start result: ${JSON.stringify(value)}`)
}
