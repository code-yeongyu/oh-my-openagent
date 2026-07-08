import { routeCompletion } from "../../completion"
import type { ParentState } from "../../completion"
import { buildPeerMessageEnvelope } from "./message"
import type { LeadDeliveryResult, LeadMessageNotifier, LeadTeamMessage, Message } from "./types"

export type DeliverToLeadInput = {
  readonly message: Message
  readonly parentState: ParentState
  readonly notifier: LeadMessageNotifier
}

/**
 * Routes a member->lead message through the SAME parent-state machine the completion push uses (todo
 * 11): an idle OR streaming lead ALWAYS receives the message steered into its next tool-call boundary
 * (no config may suppress or delay it; the omo-senpi coordinator batches everything ready into ONE
 * steer), and a mid-transition parent (compacting / switching / shutdown) buffers WITHOUT enqueue for
 * the omo-senpi coordinator to flush later. Enqueue is a synchronous fire-and-forget seam; only a sync
 * throw is observable, so a single retry is attempted before reporting failure (mirrors the completion
 * notifier).
 */
export function deliverToLead(input: DeliverToLeadInput): LeadDeliveryResult {
  const decision = routeCompletion(input.parentState)
  if (decision.kind === "buffer") return { kind: "buffered", reason: decision.reason }

  const message = buildLeadMessage(input.message, decision)
  if (!enqueueWithRetry(input.notifier, message)) return { kind: "failed" }

  if (decision.kind === "wake") return { kind: "delivered", decision: "wake" }
  return { kind: "delivered", decision: "deliver_streaming" }
}

function buildLeadMessage(
  message: Message,
  decision: Exclude<ReturnType<typeof routeCompletion>, { kind: "buffer" }>,
): LeadTeamMessage {
  const base: LeadTeamMessage = {
    customType: "senpi-task.team-message",
    content: buildPeerMessageEnvelope(message),
    display: false,
    from: message.from,
    messageId: message.messageId,
  }
  void decision
  return { ...base, triggerTurn: true }
}

function enqueueWithRetry(notifier: LeadMessageNotifier, message: LeadTeamMessage): boolean {
  return tryEnqueue(notifier, message) || tryEnqueue(notifier, message)
}

function tryEnqueue(notifier: LeadMessageNotifier, message: LeadTeamMessage): boolean {
  try {
    notifier.enqueue(message)
    return true
  } catch {
    return false
  }
}
