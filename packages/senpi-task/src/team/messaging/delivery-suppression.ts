import { commitDeliveryReservation, releaseDeliveryReservation } from "@oh-my-opencode/team-core/team-mailbox"

import { appendDeliveredEvent, appendWaitedEvent } from "./delivery-events"
import type { LeadPollState, LeadPollerDeps } from "./lead-poller-types"

// Drops a still-unflushed steering injection when the pull channel (a team_wait drain) is reporting
// the same message, then commits the reservation so the mailbox agrees the lead got it. Refuses when
// the envelope already flushed (a bounded duplicate beats committing an envelope that never
// persisted) or the sink cannot remove it; on a commit failure after a successful remove the pending
// entry is dropped and the reservation released best-effort so nothing wedges mid-flight.
export function createDeliverySuppression(
  deps: LeadPollerDeps,
  state: LeadPollState,
  withLease: <T>(fn: () => Promise<T>) => Promise<T>,
): (messageId: string) => Promise<boolean> {
  return async (messageId) => {
    if (state.isStopped()) return false
    return withLease(async () => {
      const delivery = state.pending.get(messageId)
      if (delivery === undefined || delivery.phase !== "awaiting_flush") return false
      const removed = deps.coordinator.remove?.(`team-message:${messageId}`) ?? false
      if (!removed) return false
      try {
        await commitDeliveryReservation(delivery.reservation)
      } catch (error) {
        state.pending.delete(messageId)
        try {
          await releaseDeliveryReservation(delivery.reservation)
        } catch {
          // The reservation may be half-committed; unread redelivery still dedupes via isMessageConsumed.
        }
        throw error
      }
      state.pending.delete(messageId)
      deps.deliveryJournal?.markReported(deps.teamRunId, messageId)
      appendDeliveredEvent(deps, delivery.message)
      appendWaitedEvent(deps, delivery.message)
      return true
    })
  }
}
