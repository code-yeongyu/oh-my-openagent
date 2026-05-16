import { randomUUID } from "node:crypto"

import type { TeamModeConfig } from "../../config/schema/team-mode"
import { findResolvedMemberSession } from "../../features/team-mode/member-session-resolution"
import { sendMessage } from "../../features/team-mode/team-mailbox/send"
import {
  releaseDeliveryReservation,
  reserveMessageForDelivery,
} from "../../features/team-mode/team-mailbox/reservation"
import { loadRuntimeState, transitionRuntimeState } from "../../features/team-mode/team-state-store/store"
import { resolveSessionEventID } from "../../shared/event-session-id"
import { isRecord } from "../../shared/record-type-guard"
import { log } from "../../shared/logger"

type HookInput = { event: { type: string; properties?: unknown } }
export type HookImpl = (input: HookInput) => Promise<void>

function getErroredSessionID(properties: unknown): string | undefined {
  return resolveSessionEventID(properties)
}

function extractErrorText(properties: unknown): string {
  const props = isRecord(properties) ? properties : undefined
  const errorValue = props?.["error"]
  if (errorValue instanceof Error) {
    return errorValue.message
  }
  if (typeof errorValue === "string" && errorValue.length > 0) {
    return errorValue
  }
  return "unknown error"
}

async function requeuePendingLiveDeliveries(
  teamRunId: string,
  memberName: string,
  messageIds: readonly string[],
  config: TeamModeConfig,
): Promise<void> {
  for (const messageId of messageIds) {
    const reservation = await reserveMessageForDelivery(teamRunId, memberName, messageId, config)
    if (reservation === null) {
      continue
    }

    await releaseDeliveryReservation(reservation)
  }
}

export function createTeamMemberErrorHandler(config: TeamModeConfig): HookImpl {
  return async ({ event }: HookInput): Promise<void> => {
    if (event.type !== "session.error") return

    const erroredSessionID = getErroredSessionID(event.properties)
    if (!erroredSessionID) return

    try {
      const runtimeMember = await findResolvedMemberSession(erroredSessionID, config, "team member error handler")
      if (runtimeMember === null) {
        return
      }

      const runtimeState = await loadRuntimeState(runtimeMember.teamRunId, config)
      const memberEntry = runtimeState.members.find((member) => member.name === runtimeMember.memberName)
      const pendingInjectedMessageIds = memberEntry?.pendingInjectedMessageIds ?? []
      await requeuePendingLiveDeliveries(
        runtimeState.teamRunId,
        runtimeMember.memberName,
        pendingInjectedMessageIds,
        config,
      )
      await transitionRuntimeState(runtimeState.teamRunId, (currentRuntimeState) => ({
        ...currentRuntimeState,
        members: currentRuntimeState.members.map((member) => (
          member.name === runtimeMember.memberName
            ? { ...member, status: "errored", pendingInjectedMessageIds: [] }
            : member
        )),
      }), config)

      const leaderMember = runtimeState.members.find((member) => member.agentType === "leader")
      if (leaderMember !== undefined && leaderMember.name !== runtimeMember.memberName) {
        const errorText = extractErrorText(event.properties)
        const errorBody = `Team member "${runtimeMember.memberName}" has entered an error state and will not complete its task.\nError: ${errorText}`
        try {
          await sendMessage(
            {
              version: 1,
              messageId: randomUUID(),
              from: "system",
              to: leaderMember.name,
              kind: "announcement",
              body: errorBody,
              timestamp: Date.now(),
            },
            runtimeState.teamRunId,
            config,
            { isLead: true, activeMembers: runtimeState.members.map((m) => m.name) },
          )
        } catch (sendError) {
          log("team member error handler: failed to notify lead of member error", {
            event: "team-mode-member-error-notify-failed",
            teamRunId: runtimeState.teamRunId,
            memberName: runtimeMember.memberName,
            error: sendError instanceof Error ? sendError.message : String(sendError),
          })
        }
      }

      log("team member session errored", {
        event: "team-mode-member-errored",
        teamRunId: runtimeState.teamRunId,
        teamName: runtimeState.teamName,
        memberName: runtimeMember.memberName,
        sessionID: erroredSessionID,
        runtimeStatus: runtimeState.status,
      })
    } catch (error) {
      log("team member error handler failed", {
        event: "team-mode-member-error-handler-error",
        sessionID: erroredSessionID,
        error: error instanceof Error ? error.message : String(error),
      })
    }
  }
}
