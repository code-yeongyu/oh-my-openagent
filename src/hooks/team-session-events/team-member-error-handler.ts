import type { TeamModeConfig } from "../../config/schema/team-mode"
import { findResolvedMemberSession } from "../../features/team-mode/member-session-resolution"
import {
  releaseDeliveryReservation,
  reserveMessageForDelivery,
} from "../../features/team-mode/team-mailbox/reservation"
import { loadRuntimeState, transitionRuntimeState } from "../../features/team-mode/team-state-store/store"
import { resolveSessionEventID } from "../../shared/event-session-id"
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null
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
