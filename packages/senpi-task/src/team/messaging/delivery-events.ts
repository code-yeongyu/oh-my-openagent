import type { Message } from "@oh-my-opencode/team-core/types"

import type { LeadPollerDeps } from "./lead-poller-types"

export function appendDeliveredEvent(deps: LeadPollerDeps, message: Message): void {
  const taskId = deps.eventTaskId(message)
  if (taskId === undefined) return
  deps.appendEvent?.(taskId, {
    type: "team_message_delivered",
    payload: { message_id: message.messageId, from: message.from, to: message.to, kind: message.kind },
  })
}

export function appendWaitedEvent(deps: LeadPollerDeps, message: Message): void {
  const taskId = deps.eventTaskId(message)
  if (taskId === undefined) return
  deps.appendEvent?.(taskId, {
    type: "team_message_waited",
    payload: { message_id: message.messageId, from: message.from, body: message.body },
  })
}
