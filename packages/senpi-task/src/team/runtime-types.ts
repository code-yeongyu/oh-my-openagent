import type { ToolDefinition } from "@code-yeongyu/senpi"
import type { RuntimeState } from "@oh-my-opencode/team-core/types"

import type { ManagerStartSpec, StartResult } from "../manager"
import type { TaskRecord } from "../state"
import type { CancelOutcome } from "../steering"
import type { StateDirConfig } from "../store"
import type { OmoTaskSettings } from "@oh-my-opencode/omo-config-core"
import type { MemberTaskMap } from "./member-map"

export type SenpiTeamRuntimeErrorCode =
  | "bounds_exceeded"
  | "member_start_rejected"
  | "create_deadline_exceeded"
  | "invalid_delete_state"

/**
 * Raised by the team runtime for lifecycle failures distinct from spec normalization
 * (`SenpiTeamSpecError`): bounds rejection before any spawn, a member start rejected by the manager,
 * a create-deadline breach, and an illegal delete transition. Carries the team identifier in play.
 */
export class SenpiTeamRuntimeError extends Error {
  readonly code: SenpiTeamRuntimeErrorCode
  readonly teamRef: string

  constructor(message: string, code: SenpiTeamRuntimeErrorCode, teamRef: string) {
    super(message)
    this.name = "SenpiTeamRuntimeError"
    this.code = code
    this.teamRef = teamRef
  }
}

// The TaskManager surface the team runtime spawns and cancels members through. TaskManager satisfies
// this structurally; kept narrow so the runtime never reaches past start/cancel/read.
export type TeamRuntimeManagerPort = {
  start(spec: ManagerStartSpec): Promise<StartResult>
  cancelTask(idOrName: string, reason?: string): Promise<CancelOutcome>
  get(taskId: string): TaskRecord | undefined
  getResidentHandle(taskId: string): { readonly sessionId: string | undefined } | undefined
}

export type CreateTeamDeps = {
  readonly manager: TeamRuntimeManagerPort
  readonly stateDir: StateDirConfig
  readonly taskSettings: OmoTaskSettings
  readonly leadSessionId: string
  readonly spawnDepth: number
  readonly now?: () => number
  // Optional per-member tool injection (todo 24 binds the pre-scoped `team_send_message`). Absent in
  // the runtime layer's own tests; the spawner forwards whatever it returns via memberScopedTools. The
  // team run id is threaded so the binder can run-scope the member's send tool (it is not known until
  // createRuntimeState mints it, so the caller cannot bind it up front).
  readonly memberScopedTools?: (memberName: string, teamRunId: string) => readonly ToolDefinition[]
}

export type CreateTeamResult = {
  readonly runtimeState: RuntimeState
  readonly memberTaskIds: MemberTaskMap
}

export type DeleteTeamDeps = {
  readonly manager: Pick<TeamRuntimeManagerPort, "cancelTask">
  readonly stateDir: StateDirConfig
  readonly taskSettings: OmoTaskSettings
}

export type DeleteTeamResult = {
  readonly teamRunId: string
  readonly cancelledTaskIds: readonly string[]
}
