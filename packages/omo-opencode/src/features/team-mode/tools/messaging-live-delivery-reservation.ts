import type { TeamModeConfig } from "../../../config/schema/team-mode"
import { log } from "../../../shared/logger"
import {
  type DeliveryReservation as TeamMailboxDeliveryReservation,
  releaseDeliveryReservation,
  reserveMessageForDelivery,
} from "@oh-my-opencode/team-core/team-mailbox/reservation"

export type DeliveryReservation = TeamMailboxDeliveryReservation
export type NullableDeliveryReservation = DeliveryReservation | null

export async function releaseReservationSafely(
  reservation: NullableDeliveryReservation,
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

export async function releaseReservationsForRecipients(
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
