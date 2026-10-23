import type { ConsentExchange } from "@oh-my-opencode/memory-core"

import { textOf, userTurnText } from "./recall-session-read"

// The one exchange a memory write may cite as consent (lead ruling on #10498): the newest user message on the active
// branch, and only when the message right before it is the assistant's proposal. The assistant message that is making
// this very tool call is ignored; any other assistant message after the user's reply means the agent has moved on to a
// new proposal, so there is no consent for it and the user confirms explicitly.
export function pendingConsentExchange(entries: readonly unknown[], toolCallId: unknown): ConsentExchange[] {
  const messages = entries.flatMap(conversationMessage)
  const last = messages.at(-1)
  const turn = last?.role === "assistant" && typeof toolCallId === "string" && last.toolCallIds.includes(toolCallId)
    ? messages.slice(0, -1)
    : messages
  const reply = turn.at(-1)
  const proposal = turn.at(-2)
  if (reply?.role !== "user" || proposal?.role !== "assistant" || proposal.text.trim().length === 0) return []
  return [{ proposal: proposal.text, reply: reply.text }]
}

type ConversationMessage =
  | { readonly role: "user"; readonly text: string }
  | { readonly role: "assistant"; readonly text: string; readonly toolCallIds: readonly string[] }

function conversationMessage(entry: unknown): ConversationMessage[] {
  // An image-only (empty-text) user message is still a user turn: it is not consent and it breaks adjacency.
  const user = userTurnText(entry)
  if (user !== undefined) return [{ role: "user", text: user }]
  if (!isRecord(entry) || entry.type !== "message" || !isRecord(entry.message) || entry.message.role !== "assistant") return []
  const content = entry.message.content
  const toolCallIds = Array.isArray(content)
    ? content.flatMap((block) => isRecord(block) && block.type === "toolCall" && typeof block.id === "string" ? [block.id] : [])
    : []
  return [{ role: "assistant", text: textOf(content), toolCallIds }]
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
}
