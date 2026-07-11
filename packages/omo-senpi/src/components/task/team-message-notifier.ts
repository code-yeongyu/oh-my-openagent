import type { LeadMessageNotifier, LeadTeamMessage } from "@oh-my-opencode/senpi-task"

import type { IdleInjectionCoordinator } from "../../extension/idle-injection-coordinator"
import type { SenpiExtensionAPI } from "../../extension/types"

// The senpi-task team-message custom-message type; the component registers a renderer for it.
export const TEAM_MESSAGE_MESSAGE_TYPE = "senpi-task.team-message"

/**
 * Adapt the team messaging engine's synchronous LeadMessageNotifier.enqueue seam onto senpi delivery.
 * EVERY delivered lead-message routes through the SHARED idle-injection coordinator with a DEFERRED
 * flush, so lead messages, task completions, and a pending ulw-loop continuation that become ready in
 * the same batch window collapse into exactly ONE injection steered into the running turn at the next
 * tool-call boundary. The coordinator dedupes on the message id, so the enqueue stays all-or-nothing
 * under the engine's retry: re-enqueueing the same message never double-injects. Without a coordinator
 * it falls back to a direct steer through the rich custom-message channel. senpi swallows async
 * delivery errors, so a synchronous throw here surfaces to the engine as a failed lead delivery.
 */
export function createTeamMessageNotifier(
  pi: SenpiExtensionAPI,
  coordinator?: IdleInjectionCoordinator,
  isStreaming?: () => boolean,
): LeadMessageNotifier {
  return {
    enqueue(message: LeadTeamMessage): void {
      if (coordinator !== undefined) {
        coordinator.enqueue({ key: `team-message:${message.messageId}`, source: "team-message", content: message.content })
        if (isStreaming?.() === true) coordinator.scheduleFlush()
        else coordinator.flushSoon()
        return
      }
      pi.sendMessage(
        {
          customType: message.customType,
          content: message.content,
          display: message.display,
          details: {
            from: message.from,
            messageId: message.messageId,
            ...(message.summary !== undefined && { summary: message.summary }),
            body: message.body,
          },
        },
        { triggerTurn: true, deliverAs: "steer" },
      )
    },
  }
}
