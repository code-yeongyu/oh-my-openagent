import type { ParentNotifier, ParentNotifierMessage } from "@oh-my-opencode/senpi-task"

import { IdleInjectionRetiredError, type IdleInjectionCoordinator } from "../../extension/idle-injection-coordinator"
import type { SenpiExtensionAPI } from "../../extension/types"

// The senpi-task completion custom-message type; the component registers a renderer for it.
export const TASK_COMPLETION_MESSAGE_TYPE = "senpi-task.completion"

/**
 * Adapt the engine's synchronous ParentNotifier.enqueue seam onto senpi delivery. EVERY delivered
 * completion routes through the shared idle-injection coordinator with a DEFERRED flush, so all
 * notifications that become ready within the batch window (multiple children completing near-
 * simultaneously, a pending ulw-loop continuation, team lead-messages) collapse into exactly ONE
 * injection steered into the running turn at the next tool-call boundary. Without a coordinator
 * (composition seam absent) it falls back to a direct steer through the rich custom-message channel.
 * senpi swallows async delivery errors, so a synchronous throw here surfaces as the engine's failure.
 *
 * Batching makes delivery asynchronous, so "enqueue returned" must never be read as "delivered": the
 * injection carries an `onDeliveryFailed` receipt (a failed flush, or a batch window dropped when the
 * coordinator retires on session shutdown) and a REFUSED enqueue - the coordinator is already retired
 * - throws. Both paths keep `notified_epoch` from being persisted for a completion the parent never
 * saw, which is what lets the post-reload `session_start` reconcile redeliver it instead of skipping
 * the record forever.
 */
export function createParentNotifier(
  pi: SenpiExtensionAPI,
  coordinator?: IdleInjectionCoordinator,
  isStreaming?: () => boolean,
  onDeliveryFailed?: (taskIds: readonly string[], error: unknown) => void,
): ParentNotifier {
  return {
    enqueue(message: ParentNotifierMessage): void {
      if (coordinator !== undefined) {
        const taskIds = message.details.map((detail) => detail.task_id)
        const accepted = coordinator.enqueue({
          key: injectionKey(message),
          source: "task-completion",
          customType: message.customType,
          content: message.content,
          display: message.display,
          details: message.details,
          onDeliveryFailed: (error) => onDeliveryFailed?.(taskIds, error),
        })
        // Refused: the coordinator retired with the session, so nothing is queued and no receipt is
        // coming. A synchronous throw is the engine's failure signal - it stamps
        // notification_failed_epoch and retries instead of recording a phantom delivery.
        if (accepted === false) throw new IdleInjectionRetiredError()
        // Mid-turn: collect in the batch window (the agent_end drain backstops a turn that ends first).
        // Idle: flush on the next microtask so same-tick completions batch but delivery is immediate.
        if (isStreaming?.() === true) coordinator.scheduleFlush()
        else coordinator.flushSoon()
        return
      }
      pi.sendMessage(
        {
          customType: message.customType,
          content: message.content,
          display: message.display,
          details: message.details,
        },
        { triggerTurn: true, deliverAs: "steer" },
      )
    },
  }
}

function injectionKey(message: ParentNotifierMessage): string {
  const ids = message.details.map((detail) => detail.task_id).join(",")
  return ids.length > 0 ? `task-completion:${ids}` : "task-completion"
}
