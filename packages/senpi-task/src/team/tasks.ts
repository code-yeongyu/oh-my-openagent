import {
  canClaim,
  claimTask,
  createTask,
  getTask,
  listTasks,
  updateTaskStatus,
} from "@oh-my-opencode/team-core/team-tasklist"
import type { Task } from "@oh-my-opencode/team-core/types"

import type { TeamCoreConfig } from "./runtime-config"

export {
  AlreadyClaimedError as TeamTaskAlreadyClaimedError,
  BlockedByError as TeamTaskBlockedByError,
  CrossOwnerUpdateError as TeamTaskCrossOwnerUpdateError,
  InvalidTaskTransitionError as TeamTaskInvalidTransitionError,
} from "@oh-my-opencode/team-core/team-tasklist"

// Binds a team-core tasklist to a single senpi team run: the run id plus the team-core config that
// pins storage under the senpi state dir. Every orchestration call curries these two so callers
// never re-thread them.
export type TeamTasklistContext = {
  readonly teamRunId: string
  readonly config: TeamCoreConfig
}

export type CreateTeamTaskInput = {
  readonly subject: string
  readonly description: string
  readonly status: Task["status"]
  readonly owner?: string
  readonly activeForm?: string
  readonly blocks?: readonly string[]
  readonly blockedBy?: readonly string[]
  readonly metadata?: Record<string, unknown>
}

export type TeamTaskFilter = {
  readonly status?: Task["status"]
  readonly owner?: string
}

export function createTeamTask(ctx: TeamTasklistContext, input: CreateTeamTaskInput): Promise<Task> {
  return createTask(
    ctx.teamRunId,
    {
      subject: input.subject,
      description: input.description,
      status: input.status,
      blocks: [...(input.blocks ?? [])],
      blockedBy: [...(input.blockedBy ?? [])],
      ...(input.owner !== undefined ? { owner: input.owner } : {}),
      ...(input.activeForm !== undefined ? { activeForm: input.activeForm } : {}),
      ...(input.metadata !== undefined ? { metadata: input.metadata } : {}),
    },
    ctx.config,
  )
}

export function listTeamTasks(ctx: TeamTasklistContext, filter?: TeamTaskFilter): Promise<Task[]> {
  return listTasks(ctx.teamRunId, ctx.config, filter)
}

export function getTeamTask(ctx: TeamTasklistContext, taskId: string): Promise<Task> {
  return getTask(ctx.teamRunId, taskId, ctx.config)
}

export function claimTeamTask(ctx: TeamTasklistContext, taskId: string, memberName: string): Promise<Task> {
  return claimTask(ctx.teamRunId, taskId, memberName, ctx.config)
}

export function updateTeamTaskStatus(
  ctx: TeamTasklistContext,
  taskId: string,
  status: Task["status"],
  memberName: string,
): Promise<Task> {
  return updateTaskStatus(ctx.teamRunId, taskId, status, memberName, ctx.config)
}

/**
 * Whether the task's `blockedBy` dependencies are all satisfied (completed or absent), so a member
 * may claim it now. Reads the task and the full run tasklist and applies team-core's `canClaim`.
 */
export async function canClaimTeamTask(ctx: TeamTasklistContext, taskId: string): Promise<boolean> {
  const task = await getTeamTask(ctx, taskId)
  const allTasks = await listTeamTasks(ctx)
  return canClaim(task, allTasks)
}
