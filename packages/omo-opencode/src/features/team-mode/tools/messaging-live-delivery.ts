import type { TeamModeConfig } from "../../../config/schema/team-mode"
import { buildEnvelope } from "@oh-my-opencode/team-core/team-mailbox/poll"
import { reserveMessageForDelivery } from "@oh-my-opencode/team-core/team-mailbox/reservation"
import type { Message } from "@oh-my-opencode/team-core/types"
import type { LiveDeliveryClient } from "./messaging-live-delivery-client"
import { releaseReservationSafely } from "./messaging-live-delivery-reservation"
import { deliverLiveToRecipient } from "./messaging-live-delivery-recipient"
import { loadRuntimeStateForLiveDelivery } from "./messaging-live-delivery-state"
import type { TeamSendMessageToolDeps } from "./messaging-runtime"

export type { LiveDeliveryClient } from "./messaging-live-delivery-client"

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

    await deliverLiveToRecipient({
      client,
      message,
      envelope,
      teamRunId,
      recipientName,
      recipientMember,
      reservation,
      config,
      directory,
    })
  }
}
