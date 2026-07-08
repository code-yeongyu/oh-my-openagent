import type { ParentNotifier, ParentNotifierMessage } from "@oh-my-opencode/senpi-task"

import type { IdleInjectionCoordinator } from "../../extension/idle-injection-coordinator"
import type { SenpiExtensionAPI } from "../../extension/types"

// The senpi-task completion custom-message type; the component registers a renderer for it.
export const TASK_COMPLETION_MESSAGE_TYPE = "senpi-task.completion"

/**
 * Adapt the engine's synchronous ParentNotifier.enqueue seam onto senpi delivery. Only an IDLE-edge
 * wake (triggerTurn:true AND deliverAs === undefined) routes through the idle-injection coordinator, so
 * a completion wake and a pending ulw-loop continuation on the same idle edge collapse to ONE injection
 * (the Oracle arbitration blocker). A STREAMING completion carries triggerTurn:true AND a deliverAs; it
 * is mid-turn, not on an idle edge, so it must NOT be arbitrated - it delivers directly through the rich
 * custom-message channel so the senpi-task.completion renderer applies and the configured deliver_as
 * (steer|followUp) is honored. Silent-queue completions (no triggerTurn) also stay on that channel.
 * senpi swallows async delivery errors, so a synchronous throw here surfaces as the engine's failure.
 */
export function createParentNotifier(pi: SenpiExtensionAPI, coordinator?: IdleInjectionCoordinator): ParentNotifier {
  return {
    enqueue(message: ParentNotifierMessage): void {
      if (message.triggerTurn === true && message.deliverAs === undefined && coordinator !== undefined) {
        coordinator.enqueue({ key: injectionKey(message), source: "task-completion", content: message.content })
        coordinator.flushOnIdle()
        return
      }
      const options: { triggerTurn?: boolean; deliverAs?: "steer" | "followUp" } = {
        ...(message.triggerTurn !== undefined && { triggerTurn: message.triggerTurn }),
        ...(message.deliverAs !== undefined && { deliverAs: message.deliverAs }),
      }
      pi.sendMessage(
        {
          customType: message.customType,
          content: message.content,
          display: message.display,
          details: message.details,
        },
        options,
      )
    },
  }
}

function injectionKey(message: ParentNotifierMessage): string {
  const ids = message.details.map((detail) => detail.task_id).join(",")
  return ids.length > 0 ? `task-completion:${ids}` : "task-completion"
}
