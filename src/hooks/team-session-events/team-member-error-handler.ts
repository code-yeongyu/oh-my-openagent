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
import {
  DEFAULT_SESSION_IDLE_SETTLE_MS,
  isSessionActive,
  settleAfterSessionIdle,
} from "../../shared/session-idle-settle"

type HookInput = { event: { type: string; properties?: unknown } }
export type HookImpl = (input: HookInput) => Promise<void>
type TeamMemberErrorHandlerDeps = {
  client?: {
    session?: {
      status?: () => Promise<unknown>
      messages?: (input: { path: { id: string } }) => Promise<unknown>
    }
  }
  settleMs?: number
}

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

async function shouldKeepPendingLiveDeliveries(
  deps: TeamMemberErrorHandlerDeps,
  sessionID: string,
): Promise<boolean> {
  if (typeof deps.client?.session?.status !== "function") {
    return false
  }

  await settleAfterSessionIdle(deps.settleMs ?? DEFAULT_SESSION_IDLE_SETTLE_MS)
  return await isSessionActive(deps.client, sessionID)
}

function getMessagesData(response: unknown): unknown[] {
  if (isRecord(response) && Array.isArray(response.data)) {
    return response.data
  }

  return Array.isArray(response) ? response : []
}

function valueContainsAnyMessageId(value: unknown, messageIds: ReadonlySet<string>): boolean {
  if (typeof value === "string") {
    return [...messageIds].some((messageId) => value.includes(messageId))
  }

  if (Array.isArray(value)) {
    return value.some((entry) => valueContainsAnyMessageId(entry, messageIds))
  }

  if (isRecord(value)) {
    return Object.values(value).some((entry) => valueContainsAnyMessageId(entry, messageIds))
  }

  return false
}

async function sessionHistoryContainsPendingMessage(
  deps: TeamMemberErrorHandlerDeps,
  sessionID: string,
  messageIds: readonly string[],
): Promise<boolean> {
  if (messageIds.length === 0 || typeof deps.client?.session?.messages !== "function") {
    return false
  }

  try {
    const response = await deps.client.session.messages({ path: { id: sessionID } })
    const pendingMessageIds = new Set(messageIds)
    return getMessagesData(response).some((message) => valueContainsAnyMessageId(message, pendingMessageIds))
  } catch (error) {
    log("team member session history check failed", {
      event: "team-mode-member-error-history-check-failed",
      sessionID,
      error: error instanceof Error ? error.message : String(error),
    })
    return false
  }
}

export function createTeamMemberErrorHandler(
  config: TeamModeConfig,
  deps: TeamMemberErrorHandlerDeps = {},
): HookImpl {
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
      if (await shouldKeepPendingLiveDeliveries(deps, erroredSessionID)) {
        log("team member session error ignored while session remains active", {
          event: "team-mode-member-error-active",
          teamRunId: runtimeState.teamRunId,
          teamName: runtimeState.teamName,
          memberName: runtimeMember.memberName,
          sessionID: erroredSessionID,
          pendingCount: pendingInjectedMessageIds.length,
        })
        return
      }
      if (await sessionHistoryContainsPendingMessage(deps, erroredSessionID, pendingInjectedMessageIds)) {
        log("team member session error ignored after pending peer message reached history", {
          event: "team-mode-member-error-peer-message-accepted",
          teamRunId: runtimeState.teamRunId,
          teamName: runtimeState.teamName,
          memberName: runtimeMember.memberName,
          sessionID: erroredSessionID,
          pendingCount: pendingInjectedMessageIds.length,
        })
        return
      }

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
