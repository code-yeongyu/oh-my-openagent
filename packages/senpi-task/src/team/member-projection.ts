import type { RuntimeState } from "@oh-my-opencode/team-core/types"
import { transitionRuntimeState } from "@oh-my-opencode/team-core/team-state-store"

import type { TaskStatus } from "../state"
import { readMemberTaskMap } from "./member-map"
import type { TeamCoreConfig } from "./runtime-config"

export type RuntimeMemberStatus = RuntimeState["members"][number]["status"]

/**
 * Projects a senpi task-store status onto the team-core member status vocabulary: in-flight statuses
 * map straight through, an interrupted (paused, revivable) child reads as `idle`, and every
 * terminal-failure status collapses to `errored`.
 */
export function projectMemberStatus(status: TaskStatus): RuntimeMemberStatus {
  switch (status) {
    case "pending":
      return "pending"
    case "running":
      return "running"
    case "interrupted":
      return "idle"
    case "completed":
      return "completed"
    case "error":
    case "cancelled":
    case "lost":
      return "errored"
    default:
      return assertNever(status)
  }
}

function assertNever(value: never): never {
  throw new Error(`unhandled task status: ${String(value)}`)
}

export type MemberStatusPort = {
  get(taskId: string): { readonly status: TaskStatus; readonly child_session_id?: string } | undefined
  getResidentHandle(taskId: string): { readonly sessionId: string | undefined } | undefined
}

export type RefreshTeamMemberStatusesDeps = {
  readonly manager: MemberStatusPort
  readonly config: TeamCoreConfig
  readonly runtimeDir: string
}

/**
 * Re-projects each mapped member's task-store status (and best-known child session id) into the
 * team-core runtime state under a lock. The runtime status is left unchanged (a self-transition), so
 * this is safe to call for `active` teams whenever the tool layer needs a fresh status snapshot.
 */
export async function refreshTeamMemberStatuses(
  teamRunId: string,
  deps: RefreshTeamMemberStatusesDeps,
): Promise<RuntimeState> {
  const map = await readMemberTaskMap(deps.runtimeDir)
  return transitionRuntimeState(
    teamRunId,
    (state) => ({
      ...state,
      members: state.members.map((member) => {
        const taskId = map[member.name]
        if (taskId === undefined) return member
        const record = deps.manager.get(taskId)
        if (record === undefined) return member
        const sessionId = deps.manager.getResidentHandle(taskId)?.sessionId ?? record.child_session_id ?? member.sessionId
        return {
          ...member,
          status: projectMemberStatus(record.status),
          ...(sessionId !== undefined ? { sessionId } : {}),
        }
      }),
    }),
    deps.config,
  )
}
