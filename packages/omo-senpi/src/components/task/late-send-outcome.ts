import type { LateSendOutcome } from "@oh-my-opencode/senpi-task"
import { log } from "@oh-my-opencode/utils"

import type { SenpiExtensionAPI } from "../../extension/types"

export const SEND_OUTCOME_MESSAGE_TYPE = "senpi-task.send-outcome"

// The outcome of a task_send whose caller stopped waiting on a busy task host (#10042). It belongs to
// the session that sent it, and after the user aborted that turn it is recorded without restarting it.
export function createLateSendOutcomeDeliverer(
  pi: Pick<SenpiExtensionAPI, "sendMessage">,
  currentSessionId: () => string | undefined,
): LateSendOutcome {
  return (result, delivery) => {
    if (delivery.callerSessionId !== undefined && delivery.callerSessionId !== currentSessionId()) {
      log("senpi-task task_send outcome dropped: its session is no longer active", { session: delivery.callerSessionId, details: result.details })
      return
    }
    const text = result.content.map((part) => (part.type === "text" ? part.text : "")).join("\n")
    void pi.sendMessage(
      { customType: SEND_OUTCOME_MESSAGE_TYPE, content: `task_send outcome: ${text}`, display: false, details: result.details },
      delivery.cause === "aborted" ? { deliverAs: "followUp" } : { triggerTurn: true, deliverAs: "steer" },
    )
  }
}
