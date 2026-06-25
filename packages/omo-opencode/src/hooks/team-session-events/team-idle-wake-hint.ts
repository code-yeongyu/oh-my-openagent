import type { TeamModeConfig } from "../../config/schema/team-mode"
import { findResolvedMemberSession } from "../../features/team-mode/member-session-resolution"
import {
  applyMemberSessionRouting,
  buildMemberPromptBody,
} from "../../features/team-mode/member-session-routing"
import { ackMessages } from "../../features/team-mode/team-mailbox/ack"
import { listUnreadMessages } from "../../features/team-mode/team-mailbox/inbox"
import { loadRuntimeState, transitionRuntimeState } from "../../features/team-mode/team-state-store/store"
import { findDeliveredMessageIds, requeuePendingLiveDeliveries } from "../../features/team-mode/team-mailbox/pending-delivery-recovery"
import { resolveSessionEventID } from "../../shared/event-session-id"
import { isAmbiguousPostDispatchPromptFailure } from "../../shared/prompt-failure-classifier"
import { log } from "../../shared/logger"
import { isSessionActive, settleAfterSessionIdle } from "../../shared/session-idle-settle"
import { dispatchInternalPrompt, isInternalPromptDispatchAccepted } from "../shared/prompt-async-gate"

type PromptAsyncInput = {
  path: { id: string }
  body: {
    parts: Array<{ type: "text"; text: string }>
    agent?: string
    model?: { providerID: string; modelID: string }
    variant?: string
  }
  query: { directory: string }
}

type TeamIdleWakeHintContext = {
  directory: string
  client: {
    session: {
      promptAsync?: (input: PromptAsyncInput) => Promise<unknown>
      status?: () => Promise<unknown>
      messages?: (input: { path: { id: string } }) => Promise<unknown>
    }
  }
}

type HookInput = { event: { type: string; properties?: unknown } }
export type HookImpl = (input: HookInput) => Promise<void>
type TeamIdleWakeHintOptions = { idleSettleMs?: number }
const WAKE_HINT_DUPLICATE_SUPPRESSION_MS = 30_000

function getIdleSessionID(properties: unknown): string | undefined {
  return resolveSessionEventID(properties)
}

function buildWakeHint(unreadCount: number): string {
  return `You have ${unreadCount} new team messages. They will be injected on your next turn.`
}

function buildWakeHintBatchKey(teamRunId: string, memberName: string, messageIds: string[]): string {
  return `${teamRunId}:${memberName}:${messageIds.toSorted().join(",")}`
}

async function claimPendingMessageAcks(
  teamRunId: string,
  memberName: string,
  messageIds: readonly string[],
  config: TeamModeConfig,
): Promise<string[]> {
  if (messageIds.length === 0) return []

  let claimedMessageIds: string[] = []
  const candidateMessageIds = new Set(messageIds)
  await transitionRuntimeState(teamRunId, (currentRuntimeState) => {
    const currentMember = currentRuntimeState.members.find((member) => member.name === memberName)
    if (currentMember === undefined) {
      claimedMessageIds = []
      return currentRuntimeState
    }

    claimedMessageIds = currentMember.pendingInjectedMessageIds.filter((messageId) => candidateMessageIds.has(messageId))
    if (claimedMessageIds.length === 0) {
      return currentRuntimeState
    }

    const claimedMessageIdSet = new Set(claimedMessageIds)
    return {
      ...currentRuntimeState,
      members: currentRuntimeState.members.map((member) => (
        member.name === memberName
          ? {
            ...member,
            pendingInjectedMessageIds: member.pendingInjectedMessageIds.filter((messageId) => !claimedMessageIdSet.has(messageId)),
          }
          : member
      )),
    }
  }, config)

  return claimedMessageIds
}

export function createTeamIdleWakeHint(ctx: TeamIdleWakeHintContext, config: TeamModeConfig, options?: TeamIdleWakeHintOptions): HookImpl {
  const recentWakeHintBatches = new Map<string, number>()

  return async ({ event }: HookInput): Promise<void> => {
    if (event.type !== "session.idle") return

    const sessionID = getIdleSessionID(event.properties)
    if (!sessionID) return

    try {
      const runtimeMember = await findResolvedMemberSession(sessionID, config, "team idle wake hint")
      if (runtimeMember === null) {
        return
      }

      const runtimeState = await loadRuntimeState(runtimeMember.teamRunId, config)
      const memberEntry = runtimeState.members.find((member) => member.name === runtimeMember.memberName)
      if (!memberEntry) {
        return
      }

      const pendingInjectedMessageIds = [...memberEntry.pendingInjectedMessageIds]
      if (pendingInjectedMessageIds.length > 0) {
        if (typeof ctx.client.session.status === "function") {
          await settleAfterSessionIdle(options?.idleSettleMs ?? 0)
          if (await isSessionActive(ctx.client, sessionID)) {
            log("team idle pending ack skipped while session remains active", {
              event: "team-mode-idle-pending-ack-active",
              teamRunId: runtimeState.teamRunId,
              memberName: memberEntry.name,
              sessionID,
              pendingCount: pendingInjectedMessageIds.length,
            })
            return
          }
        }

        const claimedMessageIds = await claimPendingMessageAcks(
          runtimeState.teamRunId,
          memberEntry.name,
          pendingInjectedMessageIds,
          config,
        )
        if (claimedMessageIds.length > 0) {
          const deliveredMessageIds = typeof ctx.client.session.messages === "function"
            ? await findDeliveredMessageIds(ctx.client, sessionID, claimedMessageIds)
            : new Set(claimedMessageIds)
          const ackedMessageIds = claimedMessageIds.filter((messageId) => deliveredMessageIds.has(messageId))
          const requeuedMessageIds = claimedMessageIds.filter((messageId) => !deliveredMessageIds.has(messageId))
          if (ackedMessageIds.length > 0) {
            await ackMessages(runtimeState.teamRunId, memberEntry.name, ackedMessageIds, config)
          }
          if (requeuedMessageIds.length > 0) {
            await requeuePendingLiveDeliveries(runtimeState.teamRunId, memberEntry.name, requeuedMessageIds, config)
          }
          log("team idle handled pending live delivery ack", {
            event: "team-mode-idle-pending-ack",
            teamRunId: runtimeState.teamRunId,
            memberName: memberEntry.name,
            sessionID,
            ackedCount: ackedMessageIds.length,
            requeuedCount: requeuedMessageIds.length,
          })
        }
      }

      const latestRuntimeState = await loadRuntimeState(runtimeMember.teamRunId, config)
      const latestMemberEntry = latestRuntimeState.members.find((member) => member.name === runtimeMember.memberName)
      if (!latestMemberEntry) {
        return
      }
      if (
        latestMemberEntry.status === "errored"
        || latestMemberEntry.status === "completed"
        || latestMemberEntry.status === "shutdown_approved"
      ) {
        log("team idle wake hint skipped because member is no longer idle", {
          event: "team-mode-idle-member-not-idle",
          teamRunId: latestRuntimeState.teamRunId,
          memberName: latestMemberEntry.name,
          sessionID,
          status: latestMemberEntry.status,
        })
        return
      }

      const unreadMessages = await listUnreadMessages(latestRuntimeState.teamRunId, latestMemberEntry.name, config)
      if (unreadMessages.length === 0) {
        log("team idle handled without wake hint", {
          event: "team-mode-idle-ack-only",
          teamRunId: latestRuntimeState.teamRunId,
          memberName: latestMemberEntry.name,
          sessionID,
          ackedCount: pendingInjectedMessageIds.length,
        })
        return
      }

      if (typeof ctx.client.session.promptAsync !== "function") {
        log("team idle wake hint skipped without promptAsync", {
          event: "team-mode-idle-wake-hint-skipped",
          teamRunId: latestRuntimeState.teamRunId,
          memberName: latestMemberEntry.name,
          sessionID,
          unreadCount: unreadMessages.length,
        })
        return
      }

      const now = Date.now()
      const wakeHintBatchKey = buildWakeHintBatchKey(
        latestRuntimeState.teamRunId,
        latestMemberEntry.name,
        unreadMessages.map((message) => message.messageId),
      )
      const suppressedUntil = recentWakeHintBatches.get(wakeHintBatchKey)
      if (suppressedUntil !== undefined && suppressedUntil > now) {
        log("team idle wake hint skipped for recently hinted unread batch", {
          event: "team-mode-idle-wake-hint-duplicate-suppressed",
          teamRunId: latestRuntimeState.teamRunId,
          memberName: latestMemberEntry.name,
          sessionID,
          unreadCount: unreadMessages.length,
        })
        return
      }
      if (suppressedUntil !== undefined) {
        recentWakeHintBatches.delete(wakeHintBatchKey)
      }

      applyMemberSessionRouting(sessionID, latestMemberEntry)
      const promptResult = await dispatchInternalPrompt({
        mode: "async",
        client: ctx.client,
        sessionID,
        source: "team-idle-wake-hint",
        settleMs: options?.idleSettleMs,
        queueBehavior: "defer",
        input: {
          path: { id: sessionID },
          body: buildMemberPromptBody(latestMemberEntry, buildWakeHint(unreadMessages.length)),
          query: { directory: ctx.directory },
        },
      })
      if (!isInternalPromptDispatchAccepted(promptResult)) {
        if (promptResult.status === "failed" && isAmbiguousPostDispatchPromptFailure(promptResult)) {
          recentWakeHintBatches.set(wakeHintBatchKey, Date.now() + WAKE_HINT_DUPLICATE_SUPPRESSION_MS)
        }
        log("team idle wake hint skipped by promptAsync gate", {
          event: "team-mode-idle-wake-hint-gated",
          teamRunId: latestRuntimeState.teamRunId,
          memberName: latestMemberEntry.name,
          sessionID,
          unreadCount: unreadMessages.length,
          status: promptResult.status,
        })
        return
      }
      recentWakeHintBatches.set(wakeHintBatchKey, Date.now() + WAKE_HINT_DUPLICATE_SUPPRESSION_MS)

      log("team idle wake hint sent", {
        event: "team-mode-idle-wake-hint",
        teamRunId: latestRuntimeState.teamRunId,
        memberName: latestMemberEntry.name,
        sessionID,
        unreadCount: unreadMessages.length,
        ackedCount: pendingInjectedMessageIds.length,
      })
    } catch (error) {
      log("team idle wake hint failed", {
        event: "team-mode-idle-wake-hint-error",
        sessionID,
        error: error instanceof Error ? error.message : String(error),
      })
    }
  }
}
