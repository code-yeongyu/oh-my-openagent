import type { ParentNotifier, ParentNotifierMessage } from "@oh-my-opencode/senpi-task"

import type { IdleInjectionCoordinator } from "../../extension/idle-injection-coordinator"
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
 */
export function createParentNotifier(
  pi: SenpiExtensionAPI,
  coordinator?: IdleInjectionCoordinator,
  isStreaming?: () => boolean,
): ParentNotifier {
  return {
    enqueue(message: ParentNotifierMessage): void {
      if (coordinator !== undefined) {
        coordinator.enqueue({ key: injectionKey(message), source: "task-completion", content: message.content })
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
