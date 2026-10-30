import type { ExtensionAPI } from "@code-yeongyu/senpi"

import { readMemberSessionIdentity, readSessionRole } from "../../runners/rpc-host/session-role"
import { resolveChildSessionDir } from "../../runners/rpc/spawn"
import { parseMemberExtensionEnv, type ParsedMemberExtensionEnv } from "./parse-env"

/**
 * WHERE a member learns who it is, and how it tells the host it is on duty.
 *
 * A member that runs as its own process reads the environment its parent spawned it with. A member
 * that runs as a session of the shared daemon reads the labels the opener attached to THAT session:
 * one extension set serves every session, so the environment of whoever started the daemon says
 * nothing about the session in front of us.
 */

/** The member's identity for this session, or undefined when this session is not a member at all. */
export function resolveMemberExtensionConfig(
  pi: unknown,
  env: NodeJS.ProcessEnv,
): ParsedMemberExtensionEnv | undefined {
  const identity = readMemberSessionIdentity(pi)
  if (identity !== undefined) {
    return parseMemberExtensionEnv({
      SENPI_TASK_MEMBER: `${identity.teamRunId}::${identity.memberName}`,
      SENPI_TASK_MEMBER_TASK_ID: identity.taskId,
      SENPI_TASK_TEAM_CONFIG: identity.teamConfig,
      // The daemon child's transcript lives where the runner opened it, under our own state dir.
      SENPI_CODING_AGENT_SESSION_DIR: resolveChildSessionDir(identity.stateDir, identity.taskId),
    })
  }
  return readSessionRole(pi, env) === "member" ? parseMemberExtensionEnv(env) : undefined
}

/** senpi's monitor-state event: a session with a live wake source is never parked mid-run. */
export const MEMBER_WAKE_SOURCE_STATE_EVENT = "wake_source_state"
export const MEMBER_WAKE_SOURCE = "senpi-task-member"

export interface MemberWakeSource {
  /** The team run is live: this member is on duty until it says otherwise. */
  publishActive(): void
  /** The run let go of this member: nothing here should hold the session awake. */
  publishIdle(): void
}

export function createMemberWakeSource(
  pi: ExtensionAPI,
  member: { readonly teamRunId: string; readonly memberName: string; readonly now?: () => number },
): MemberWakeSource {
  const startedAtMs = (member.now ?? Date.now)()
  const publish = (channels: readonly Record<string, unknown>[]): void => {
    pi.events?.emit(MEMBER_WAKE_SOURCE_STATE_EVENT, {
      source: MEMBER_WAKE_SOURCE,
      activeCount: channels.length,
      channels,
    })
  }
  return {
    publishActive: () =>
      publish([{ id: member.teamRunId, description: `team member ${member.memberName}`, startedAtMs }]),
    publishIdle: () => publish([]),
  }
}
