import { isGpt6AstraModel } from "@oh-my-opencode/model-core"
import { ASTRA_DAG_VERIFICATION_DIRECTIVE, buildCompletionMessage, type ParentNotifier, type ParentNotifierMessage } from "@oh-my-opencode/senpi-task"

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
  getReceiverModel?: () => string | undefined,
): ParentNotifier {
  return {
    enqueue(message: ParentNotifierMessage): void {
      const content = (): string => message.details.some((detail) => detail.dag !== undefined)
        ? buildCompletionMessage(message.details, isGpt6AstraModel(getReceiverModel?.()) ? ASTRA_DAG_VERIFICATION_DIRECTIVE : undefined).content
        : message.content
      if (coordinator !== undefined) {
        for (const detail of message.details) {
          const accepted = coordinator.enqueue({
            key: `task-completion:${detail.task_id}`,
            source: "task-completion",
            runRef: detail.runRef ?? (detail.dag === undefined
              ? { kind: "task", id: detail.task_id }
              : { kind: "dag", id: detail.dag.run_id }),
            customType: message.customType,
            get content() {
              return message.details.length === 1 && detail.dag === undefined ? message.content
                : buildCompletionMessage([detail], isGpt6AstraModel(getReceiverModel?.()) ? ASTRA_DAG_VERIFICATION_DIRECTIVE : undefined).content
            },
            display: message.display,
            details: [detail],
            ...(detail.dag === undefined ? {} : { contextScoped: true }),
            onDeliveryFailed: (error) => onDeliveryFailed?.([detail.task_id], error),
          })
          if (accepted === false) throw new IdleInjectionRetiredError()
        }
        // Mid-turn: collect in the batch window (the agent_end drain backstops a turn that ends first).
        // Idle: flush on the next microtask so same-tick completions batch but delivery is immediate.
        if (isStreaming?.() === true) coordinator.scheduleFlush()
        else coordinator.flushSoon()
        return
      }
      pi.sendMessage(
        {
          customType: message.customType,
          content: content(),
          display: message.display,
          details: message.details,
        },
        { triggerTurn: true, deliverAs: "steer" },
      )
    },
  }
}
