import type { RuntimeState } from "@oh-my-opencode/team-core/types"

import type { ManagerStartSpec, StartResult } from "../manager"
import type { ResolvedModelRecord, TaskRecord } from "../state"
import type { CancelOutcome } from "../steering"
import type { StateDirConfig } from "../store"
import type { OmoTaskSettings } from "@oh-my-opencode/omo-config-core"
import type { MemberTaskMap } from "./member-map"
import type { RuntimeMemberStatus } from "./member-projection"

export type SenpiTeamRuntimeErrorCode =
  | "bounds_exceeded"
  | "member_start_rejected"
  | "create_deadline_exceeded"
  | "invalid_delete_state"
  | "foreign_lead"
  | "sidecar_write_failed"

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
  cancelTask(idOrName: string, reason?: string, callerSessionId?: string): Promise<CancelOutcome>
  get(taskId: string): TaskRecord | undefined
  getResidentHandle(taskId: string): { readonly sessionId: string | undefined } | undefined
}

export type TeamMemberExtensionConfig = {
  readonly entryPath: string
  readonly inheritedExtensions?: readonly string[]
}

export type SpawnMemberExtensionConfig = TeamMemberExtensionConfig & {
  readonly teamConfig: string
}

export type CreateTeamDeps = {
  readonly manager: TeamRuntimeManagerPort
  readonly stateDir: StateDirConfig
  readonly taskSettings: OmoTaskSettings
  readonly leadSessionId: string
  readonly spawnDepth: number
  readonly now?: () => number
  readonly memberExtension?: TeamMemberExtensionConfig
  // Injectable member-sidecar writer (defaults to the atomic writeMemberTaskMap). Present so tests can
  // force the pre-activation write to fail and exercise the create rollback.
  readonly writeMemberMap?: (runtimeDir: string, map: MemberTaskMap) => Promise<void>
}

export type CreatedMemberRole =
  | { readonly kind: "category"; readonly category: string }
  | { readonly kind: "subagent_type"; readonly subagentType: string }

// Caller-facing view of one spawned member: identity and live status from the runtime state, the
// role from the spec, the resolved model captured at spawn, and a bounded prompt excerpt.
export type CreatedMemberInfo = {
  readonly name: string
  readonly taskId: string
  readonly status: RuntimeMemberStatus
  readonly role: CreatedMemberRole
  readonly model?: ResolvedModelRecord
  readonly promptExcerpt?: string
}

export type CreateTeamResult = {
  readonly runtimeState: RuntimeState
  readonly memberTaskIds: MemberTaskMap
  readonly members: readonly CreatedMemberInfo[]
}

export type DeleteTeamDeps = {
  readonly manager: Pick<TeamRuntimeManagerPort, "cancelTask">
  readonly callerSessionId: string
  readonly stateDir: StateDirConfig
  readonly taskSettings: OmoTaskSettings
}

export type DeleteTeamResult = {
  readonly teamRunId: string
  readonly cancelledTaskIds: readonly string[]
}
