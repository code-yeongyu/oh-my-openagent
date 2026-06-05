import type { TeamModeConfig } from "../../../config/schema/team-mode"
import { dispatchInternalPrompt, isInternalPromptDispatchAccepted } from "../../../hooks/shared/prompt-async-gate"
import { log } from "../../../shared/logger"
import { isAmbiguousPostDispatchPromptFailure } from "../../../shared/prompt-failure-classifier"
import { applyMemberSessionRouting, buildMemberPromptBody } from "../member-session-routing"
import { buildEnvelope } from "../team-mailbox/poll"
import {
  commitDeliveryReservation,
  releaseDeliveryReservation,
  reserveMessageForDelivery,
} from "../team-mailbox/reservation"
import { transitionRuntimeState } from "../team-state-store/store"
import type { Message, RuntimeState } from "../types"
import type { TeamSendMessageToolDeps } from "./messaging-runtime"

export type LiveDeliveryClient = {
  session: {
    promptAsync(input: {
      path: { id: string }
      body: {
        parts: Array<{ type: "text"; text: string }>
        agent?: string
        model?: { providerID: string; modelID: string }
        variant?: string
      }
      query?: { directory: string }
    }): Promise<unknown>
    status?: () => Promise<unknown>
  }
}

type DeliveryReservation = Awaited<ReturnType<typeof reserveMessageForDelivery>>

async function releaseReservationSafely(
  reservation: DeliveryReservation,
  input: { teamRunId: string; recipient: string; messageId: string },
): Promise<void> {
  if (reservation === null) return

  try {
    await releaseDeliveryReservation(reservation)
  } catch (releaseError) {
    log("[team-mailbox] failed to release delivery reservation", {
      error: releaseError instanceof Error ? releaseError.message : String(releaseError),
      teamRunId: input.teamRunId,
      recipient: input.recipient,
      messageId: input.messageId,
    })
  }
}

async function markLiveDeliveryPending(
  teamRunId: string,
  recipientName: string,
  messageId: string,
  config: TeamModeConfig,
): Promise<void> {
  await transitionRuntimeState(teamRunId, (currentRuntimeState) => ({
    ...currentRuntimeState,
    members: currentRuntimeState.members.map((member) => (
      member.name === recipientName
        ? {
          ...member,
          pendingInjectedMessageIds: Array.from(new Set([...member.pendingInjectedMessageIds, messageId])),
        }
        : member
    )),
  }), config)
}

async function releaseReservationsForRecipients(
  teamRunId: string,
  recipientNames: readonly string[],
  messageId: string,
  config: TeamModeConfig,
): Promise<void> {
  for (const recipientName of recipientNames) {
    const reservation = await reserveMessageForDelivery(teamRunId, recipientName, messageId, config)
    await releaseReservationSafely(reservation, {
      teamRunId,
      recipient: recipientName,
      messageId,
    })
  }
}

async function loadRuntimeStateForLiveDelivery(
  teamRunId: string,
  deliveredTo: readonly string[],
  messageId: string,
  config: TeamModeConfig,
  deps: TeamSendMessageToolDeps,
): Promise<RuntimeState | undefined> {
  try {
    return await deps.loadRuntimeState(teamRunId, config)
  } catch (error) {
    await releaseReservationsForRecipients(teamRunId, deliveredTo, messageId, config)
    log("[team-mailbox] live delivery unavailable after pre-reserve, released recipients to inbox", {
      teamRunId,
      messageId,
      deliveredTo,
      error: error instanceof Error ? error.message : String(error),
    })
    return undefined
  }
}

export async function deliverLive(
  client: LiveDeliveryClient,
  message: Message,
  teamRunId: string,
  deliveredTo: readonly string[],
  config: TeamModeConfig,
  directory: string,
  deps: TeamSendMessageToolDeps,
): Promise<void> {
  const runtimeState = await loadRuntimeStateForLiveDelivery(teamRunId, deliveredTo, message.messageId, config, deps)
  if (!runtimeState) return

  const envelope = buildEnvelope(message)

  for (const recipientName of deliveredTo) {
    const reservation = await reserveMessageForDelivery(teamRunId, recipientName, message.messageId, config)
    if (reservation === null) continue

    const recipientMember = runtimeState.members.find((entry) => entry.name === recipientName)
    if (!recipientMember) {
      await releaseReservationSafely(reservation, {
        teamRunId,
        recipient: recipientName,
        messageId: message.messageId,
      })
      continue
    }

    if (recipientMember.pendingInjectedMessageIds.length > 0) {
      await releaseReservationSafely(reservation, {
        teamRunId,
        recipient: recipientName,
        messageId: message.messageId,
      })
      continue
    }

    if (recipientMember.status !== "idle") {
      log("[team-mailbox] live delivery unavailable, recipient is not idle", {
        reason: "recipient-not-idle",
        teamRunId,
        recipient: recipientName,
        status: recipientMember.status,
        messageId: message.messageId,
      })
      await releaseReservationSafely(reservation, {
        teamRunId,
        recipient: recipientName,
        messageId: message.messageId,
      })
      continue
    }

    const recipientSessionId = recipientMember.sessionId
    if (!recipientSessionId) {
      log("[team-mailbox] live delivery unavailable, falling back to inbox injection", {
        reason: "missing-session-id",
        teamRunId,
        recipient: recipientName,
        messageId: message.messageId,
      })
      await releaseReservationSafely(reservation, {
        teamRunId,
        recipient: recipientName,
        messageId: message.messageId,
      })
      continue
    }

    applyMemberSessionRouting(recipientSessionId, recipientMember)

    try {
      const promptResult = await dispatchInternalPrompt({
        mode: "async",
        client,
        sessionID: recipientSessionId,
        source: "team-live-delivery",
        queueBehavior: "defer",
        input: {
          path: { id: recipientSessionId },
          body: buildMemberPromptBody(recipientMember, envelope),
          query: { directory: recipientMember.worktreePath ?? directory },
        },
      })
      if (promptResult.status === "failed" && isAmbiguousPostDispatchPromptFailure(promptResult)) {
        await releaseReservationSafely(reservation, {
          teamRunId,
          recipient: recipientName,
          messageId: message.messageId,
        })
        log("[team-mailbox] live delivery prompt failed ambiguously, released reservation to inbox", {
          teamRunId,
          recipient: recipientName,
          recipientSessionId,
          messageId: message.messageId,
          error: promptResult.error instanceof Error ? promptResult.error.message : String(promptResult.error),
        })
        continue
      }
      if (!isInternalPromptDispatchAccepted(promptResult)) {
        log("[team-mailbox] live delivery skipped by promptAsync gate, falling back to inbox injection", {
          status: promptResult.status,
          teamRunId,
          recipient: recipientName,
          recipientSessionId,
          messageId: message.messageId,
        })
        await releaseReservationSafely(reservation, {
          teamRunId,
          recipient: recipientName,
          messageId: message.messageId,
        })
        continue
      }
      try {
        await markLiveDeliveryPending(teamRunId, recipientName, message.messageId, config)
      } catch (markError) {
        try {
          await commitDeliveryReservation(reservation)
        } catch (commitError) {
          log("[team-mailbox] live delivery prompt dispatched but pending mark and reservation commit failed", {
            teamRunId,
            recipient: recipientName,
            recipientSessionId,
            messageId: message.messageId,
            error: commitError instanceof Error ? commitError.message : String(commitError),
          })
        }
        log("[team-mailbox] live delivery prompt dispatched but pending mark failed, committed reservation directly", {
          teamRunId,
          recipient: recipientName,
          recipientSessionId,
          messageId: message.messageId,
          error: markError instanceof Error ? markError.message : String(markError),
        })
        continue
      }
      log("[team-mailbox] live delivery reserved until recipient idle", {
        teamRunId,
        recipient: recipientName,
        recipientSessionId,
        messageId: message.messageId,
      })
    } catch (error) {
      log("[team-mailbox] live delivery failed, falling back to inbox injection", {
        error: error instanceof Error ? error.message : String(error),
        teamRunId,
        recipient: recipientName,
        messageId: message.messageId,
      })
      await releaseReservationSafely(reservation, {
        teamRunId,
        recipient: recipientName,
        messageId: message.messageId,
      })
    }
  }
}
