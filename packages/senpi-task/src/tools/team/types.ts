import type { RuntimeState, Task } from "@oh-my-opencode/team-core/types"

import type { CreateTeamResult, DeleteTeamResult, SendTeamMessageInput, SendTeamMessageResult } from "../../team"

// The active-team row team_list returns, mirroring team-core listActiveTeams.
export type ActiveTeamSummary = {
  readonly teamRunId: string
  readonly teamName: string
  readonly status: string
  readonly memberCount: number
  readonly scope: "project" | "user"
}

export type TeamTaskStatus = Task["status"]

export type CreateTeamToolInput = {
  readonly teamName?: string
  readonly inlineSpec?: unknown
}

export type CreateTeamTaskServiceInput = {
  readonly subject: string
  readonly description: string
  readonly status: TeamTaskStatus
  readonly owner?: string
  readonly blockedBy?: readonly string[]
}

export type UpdateTeamTaskServiceInput = {
  readonly teamRunId: string
  readonly taskId: string
  readonly status: TeamTaskStatus
  readonly owner?: string
}

// The team-runtime service the tool layer drives. The omo-senpi component (todo 24 wiring) binds it to
// the live task manager, team-core config, the idle-coordinator-backed lead notifier, and the current
// lead session. Every method throws the team layer's typed errors; the tools catch and map them to
// structured `details`, never prose-only. The tools NEVER reach the store or team-core directly.
export type TeamToolsService = {
  createTeam(input: CreateTeamToolInput): Promise<CreateTeamResult>
  deleteTeam(input: { readonly teamRunId: string; readonly force?: boolean }): Promise<DeleteTeamResult>
  sendMessage(teamRunId: string, input: SendTeamMessageInput): Promise<SendTeamMessageResult>
  status(teamRunId: string): Promise<RuntimeState>
  listTeams(): Promise<readonly ActiveTeamSummary[]>
  createTask(teamRunId: string, input: CreateTeamTaskServiceInput): Promise<Task>
  listTasks(teamRunId: string, filter?: { status?: TeamTaskStatus; owner?: string }): Promise<readonly Task[]>
  updateTask(input: UpdateTeamTaskServiceInput): Promise<Task>
  getTask(teamRunId: string, taskId: string): Promise<Task>
  requestShutdown(teamRunId: string, member: string): Promise<RuntimeState>
  approveShutdown(teamRunId: string, member: string): Promise<RuntimeState>
  rejectShutdown(teamRunId: string, member: string, reason: string): Promise<RuntimeState>
}

export type TeamToolDeps = {
  readonly service: TeamToolsService
}
