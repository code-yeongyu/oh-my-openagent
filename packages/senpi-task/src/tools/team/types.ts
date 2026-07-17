import type { Message, RuntimeState, Task } from "@oh-my-opencode/team-core/types"

import type { CreateTeamResult, DeleteTeamResult, SendTeamMessageInput, SendTeamMessageResult } from "../../team"
import type { LeadPoller } from "../../team/messaging/lead-poller"
import type { WaitRegistry } from "../../team/messaging/wait-registry"
import type { WaitBounds } from "../control"

export type ActiveTeamSummary = {
  readonly teamRunId: string
  readonly teamName: string
  readonly status: string
  readonly memberCount: number
  readonly scope: "project" | "user"
  readonly leadSessionId?: string
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

type TeamWaitDeps = {
  readonly waitBounds: WaitBounds
  readonly registry: WaitRegistry<Message>
  readonly resolveLeadPoller: (teamRunId: string) => LeadPoller | undefined
  readonly resolveTeamRunId: (explicit?: string) => Promise<
    | { readonly ok: true; readonly teamRunId: string }
    | { readonly ok: false; readonly reason: string }
  >
}

export type TeamToolDeps = {
  readonly service: TeamToolsService
} & Partial<TeamWaitDeps>

export type LeadTeamToolDeps = TeamToolDeps & TeamWaitDeps
