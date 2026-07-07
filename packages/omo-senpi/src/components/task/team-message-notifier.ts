import type { LeadMessageNotifier, LeadTeamMessage } from "@oh-my-opencode/senpi-task"

import type { IdleInjectionCoordinator } from "../../extension/idle-injection-coordinator"
import type { SenpiExtensionAPI } from "../../extension/types"

// The senpi-task team-message custom-message type; the component registers a renderer for it.
export const TEAM_MESSAGE_MESSAGE_TYPE = "senpi-task.team-message"

/**
 * Adapt the team messaging engine's synchronous LeadMessageNotifier.enqueue seam onto senpi delivery.
 * A wake (triggerTurn = an idle lead) routes through the SHARED idle-injection coordinator so a team
 * lead-message wake and a task-completion wake landing on the same idle edge collapse to ONE injection
 * (the completion path enqueues + flushOnIdle synchronously; this path enqueues + schedules a deferred
 * flush, which the synchronous flush drains first). The coordinator dedupes on the message id, so the
 * enqueue is all-or-nothing under the engine's retry: a re-enqueue of the same message never
 * double-injects. Streaming / silent-queue deliveries keep the rich custom-message channel so the
 * senpi-task.team-message renderer applies. senpi swallows async delivery errors, so a synchronous
 * throw here surfaces to the engine as a failed lead delivery.
 */
export function createTeamMessageNotifier(pi: SenpiExtensionAPI, coordinator?: IdleInjectionCoordinator): LeadMessageNotifier {
  return {
    enqueue(message: LeadTeamMessage): void {
      if (message.triggerTurn === true && coordinator !== undefined) {
        coordinator.enqueue({ key: `team-message:${message.messageId}`, source: "team-message", content: message.content })
        coordinator.scheduleFlush()
        return
      }
      const options: { triggerTurn?: boolean; deliverAs?: "steer" | "followUp" } = {
        ...(message.triggerTurn !== undefined && { triggerTurn: message.triggerTurn }),
        ...(message.deliverAs !== undefined && { deliverAs: message.deliverAs }),
      }
      pi.sendMessage(
        { customType: message.customType, content: message.content, display: message.display, details: { from: message.from, messageId: message.messageId } },
        options,
      )
    },
  }
}
