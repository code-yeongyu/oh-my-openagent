import type { TeamModeConfig } from "../../config/schema/team-mode"
import { ackMessages } from "../../features/team-mode/team-mailbox/ack"
import { listUnreadMessages } from "../../features/team-mode/team-mailbox/inbox"
import { loadRuntimeState, listActiveTeams, transitionRuntimeState } from "../../features/team-mode/team-state-store/store"
import { findResolvedMemberSession } from "../../features/team-mode/member-session-resolution"
import {
  applyMemberSessionRouting,
  buildMemberPromptBody,
} from "../../features/team-mode/member-session-routing"
import { resolveSessionEventID } from "../../shared/event-session-id"
import { log } from "../../shared/logger"
import { promptAsyncAfterSessionIdle } from "../shared/prompt-async-gate"

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
    }
  }
}

type HookInput = { event: { type: string; properties?: unknown } }
export type HookImpl = (input: HookInput) => Promise<void>
type TeamIdleWakeHintOptions = { idleSettleMs?: number }

function getIdleSessionID(properties: unknown): string | undefined {
  return resolveSessionEventID(properties)
}

function buildWakeHint(unreadCount: number): string {
  return `You have ${unreadCount} new team messages. They will be injected on your next turn.`
}

export function createTeamIdleWakeHint(ctx: TeamIdleWakeHintContext, config: TeamModeConfig, options?: TeamIdleWakeHintOptions): HookImpl {
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
      if (!memberEntry || memberEntry.agentType === "leader") {
        return
      }

      const pendingInjectedMessageIds = [...memberEntry.pendingInjectedMessageIds]
      if (pendingInjectedMessageIds.length > 0) {
        await ackMessages(runtimeState.teamRunId, memberEntry.name, pendingInjectedMessageIds, config)
        await transitionRuntimeState(runtimeState.teamRunId, (currentRuntimeState) => ({
          ...currentRuntimeState,
          members: currentRuntimeState.members.map((member) => (
            member.name === memberEntry.name
              ? { ...member, pendingInjectedMessageIds: [] }
              : member
          )),
        }), config)
      }

      const unreadMessages = await listUnreadMessages(runtimeState.teamRunId, memberEntry.name, config)
      if (unreadMessages.length === 0) {
        log("team idle handled without wake hint", {
          event: "team-mode-idle-ack-only",
          teamRunId: runtimeState.teamRunId,
          memberName: memberEntry.name,
          sessionID,
          ackedCount: pendingInjectedMessageIds.length,
        })
        return
      }

      if (typeof ctx.client.session.promptAsync !== "function") {
        log("team idle wake hint skipped without promptAsync", {
          event: "team-mode-idle-wake-hint-skipped",
          teamRunId: runtimeState.teamRunId,
          memberName: memberEntry.name,
          sessionID,
          unreadCount: unreadMessages.length,
        })
        return
      }

      applyMemberSessionRouting(sessionID, memberEntry)
      const promptResult = await promptAsyncAfterSessionIdle({
        client: ctx.client,
        sessionID,
        source: "team-idle-wake-hint",
        settleMs: options?.idleSettleMs,
        input: {
          path: { id: sessionID },
          body: buildMemberPromptBody(memberEntry, buildWakeHint(unreadMessages.length)),
          query: { directory: ctx.directory },
        },
      })
      if (promptResult.status !== "dispatched") {
        log("team idle wake hint skipped by promptAsync gate", {
          event: "team-mode-idle-wake-hint-gated",
          teamRunId: runtimeState.teamRunId,
          memberName: memberEntry.name,
          sessionID,
          unreadCount: unreadMessages.length,
          status: promptResult.status,
        })
        return
      }

      log("team idle wake hint sent", {
        event: "team-mode-idle-wake-hint",
        teamRunId: runtimeState.teamRunId,
        memberName: memberEntry.name,
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
