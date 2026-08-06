import type { TeamModeConfig } from "../../../config/schema/team-mode"
import { dispatchInternalPrompt, isInternalPromptDispatchAccepted } from "../../../hooks/shared/prompt-async-gate"
import { log } from "../../../shared/logger"
import { isAmbiguousPostDispatchPromptFailure } from "../../../shared/prompt-failure-classifier"
import { applyMemberSessionRouting, buildMemberPromptBody } from "../member-session-routing"
import { buildEnvelope } from "@oh-my-opencode/team-core/team-mailbox/poll"
import { commitDeliveryReservation } from "@oh-my-opencode/team-core/team-mailbox/reservation"
import type { Message, RuntimeState } from "@oh-my-opencode/team-core/types"
import type { LiveDeliveryClient } from "./messaging-live-delivery-client"
import type { DeliveryReservation } from "./messaging-live-delivery-reservation"
import { releaseReservationSafely } from "./messaging-live-delivery-reservation"
import { markLiveDeliveryPending } from "./messaging-live-delivery-state"

type RuntimeMember = RuntimeState["members"][number]
type LiveDeliveryEnvelope = ReturnType<typeof buildEnvelope>

export async function deliverLiveToRecipient(input: {
  client: LiveDeliveryClient
  message: Message
  envelope: LiveDeliveryEnvelope
  teamRunId: string
  recipientName: string
  recipientMember: RuntimeMember
  reservation: DeliveryReservation
  config: TeamModeConfig
  directory: string
}): Promise<void> {
  const {
    client,
    message,
    envelope,
    teamRunId,
    recipientName,
    recipientMember,
    reservation,
    config,
    directory,
  } = input

  if (recipientMember.pendingInjectedMessageIds.length > 0) {
    await releaseReservationSafely(reservation, {
      teamRunId,
      recipient: recipientName,
      messageId: message.messageId,
    })
    return
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
    return
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
    return
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
      await markLiveDeliveryAcceptedLike({
        teamRunId,
        recipientName,
        recipientSessionId,
        messageId: message.messageId,
        reservation,
        config,
        logReason: "live delivery prompt failed ambiguously",
      })
      log("[team-mailbox] live delivery prompt failed ambiguously, retained reservation against duplicate injection", {
        teamRunId,
        recipient: recipientName,
        recipientSessionId,
        messageId: message.messageId,
        error: promptResult.error instanceof Error ? promptResult.error.message : String(promptResult.error),
      })
      return
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
      return
    }
    await markLiveDeliveryAcceptedLike({
      teamRunId,
      recipientName,
      recipientSessionId,
      messageId: message.messageId,
      reservation,
      config,
      logReason: "live delivery prompt dispatched",
    })
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

async function markLiveDeliveryAcceptedLike(input: {
  readonly teamRunId: string
  readonly recipientName: string
  readonly recipientSessionId: string
  readonly messageId: string
  readonly reservation: DeliveryReservation
  readonly config: TeamModeConfig
  readonly logReason: string
}): Promise<void> {
  try {
    await markLiveDeliveryPending(input.teamRunId, input.recipientName, input.messageId, input.config)
  } catch (markError) {
    try {
      await commitDeliveryReservation(input.reservation)
    } catch (commitError) {
      log("[team-mailbox] live delivery accepted-like prompt but pending mark and reservation commit failed", {
        teamRunId: input.teamRunId,
        recipient: input.recipientName,
        recipientSessionId: input.recipientSessionId,
        messageId: input.messageId,
        reason: input.logReason,
        error: commitError instanceof Error ? commitError.message : String(commitError),
      })
    }
    log("[team-mailbox] live delivery accepted-like prompt but pending mark failed, committed reservation directly", {
      teamRunId: input.teamRunId,
      recipient: input.recipientName,
      recipientSessionId: input.recipientSessionId,
      messageId: input.messageId,
      reason: input.logReason,
      error: markError instanceof Error ? markError.message : String(markError),
    })
  }
}
