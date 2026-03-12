import type { BackgroundManager } from "../background-agent"
import type { TmuxSessionManager } from "../tmux-subagent"
import { bootstrapTeamModeRun } from "./orchestrator"
import {
  appendTeamMailboxMessage,
  claimNextTeamTask,
  findActiveTeamForLeaderSession,
  initializeTeamRuntime,
  markTeamMailboxMessageDelivered,
  requestTeamShutdown,
  transitionTeamTask,
} from "./runtime"
import { getTeamStatePath, readTeamRuntimeState } from "./state"
import type {
  ClaimTeamTaskInput,
  InitializeTeamModeInput,
  MailboxMessageInput,
  ShutdownRequestInput,
  TransitionTeamTaskInput,
} from "./types"

export class TeamModeManager {
  constructor(
    private readonly directory: string,
    private readonly backgroundManager: BackgroundManager,
    private readonly tmuxSessionManager: TmuxSessionManager,
  ) {}

  getSessionManager(): TmuxSessionManager {
    return this.tmuxSessionManager
  }

  createRuntime(input: InitializeTeamModeInput) {
    return initializeTeamRuntime(input)
  }

  readRuntime(teamId: string) {
    return readTeamRuntimeState(this.directory, teamId)
  }

  findActiveTeamForLeaderSession(leaderSessionId: string) {
    return findActiveTeamForLeaderSession(this.directory, leaderSessionId)
  }

  getTeamStatePath(teamId: string): string {
    return getTeamStatePath(this.directory, teamId)
  }

  async bootstrapRun(input: {
    teamId: string
    sessionID: string
    parentMessageID?: string
    planName: string
    teamStatePath: string
    workerIds: string[]
    worktreePath?: string
  }): Promise<void> {
    await bootstrapTeamModeRun({
      backgroundManager: this.backgroundManager,
      directory: this.directory,
      teamId: input.teamId,
      sessionID: input.sessionID,
      parentMessageID: input.parentMessageID,
      planName: input.planName,
      teamStatePath: input.teamStatePath,
      workerIds: input.workerIds,
      worktreePath: input.worktreePath,
    })
  }

  claimNextTask(teamId: string, input: ClaimTeamTaskInput) {
    return claimNextTeamTask(this.directory, teamId, input)
  }

  transitionTask(teamId: string, input: TransitionTeamTaskInput) {
    return transitionTeamTask(this.directory, teamId, input)
  }

  appendMailboxMessage(teamId: string, input: MailboxMessageInput) {
    return appendTeamMailboxMessage(this.directory, teamId, input)
  }

  markMailboxMessageDelivered(teamId: string, messageId: string, deliveredAt?: string) {
    return markTeamMailboxMessageDelivered(this.directory, teamId, messageId, deliveredAt)
  }

  requestShutdown(teamId: string, input: ShutdownRequestInput) {
    return requestTeamShutdown(this.directory, teamId, input)
  }
}
