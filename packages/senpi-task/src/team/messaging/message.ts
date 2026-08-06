import { randomUUID } from "node:crypto"

import type { Message } from "@oh-my-opencode/team-core/types"

import type { SendTeamMessageInput } from "./types"

export type BuildTeamMessageOptions = {
  readonly now?: () => number
  readonly newMessageId?: () => string
}

/**
 * Builds a `kind: "message"` team-core `Message` for a team send. `messageId`/`timestamp` are injected
 * (defaulting to `randomUUID`/`Date.now`) so tests stay deterministic. `to` is passed through verbatim
 * (a member name, the "lead" sentinel, or "*"); `correlationId`/`references`/`color` are left unset.
 */
export function buildTeamMessage(
  input: Pick<SendTeamMessageInput, "from" | "to" | "body" | "summary">,
  options: BuildTeamMessageOptions = {},
): Message {
  const timestamp = (options.now ?? Date.now)()
  const messageId = (options.newMessageId ?? randomUUID)()
  const base: Message = {
    version: 1,
    messageId,
    from: input.from,
    to: input.to,
    kind: "message",
    body: input.body,
    timestamp,
  }
  return input.summary === undefined ? base : { ...base, summary: input.summary }
}

// Byte-for-byte mirror of team-core team-mailbox `buildEnvelope` (poll.ts), replicated here because
// that helper is only reachable via a forbidden deep subpath. The inject fallback path calls the real
// team-core envelope via `pollAndBuildInjection`; `inject.test.ts` asserts the two stay identical.
export function buildPeerMessageEnvelope(message: Message): string {
  const attributes = [
    `from="${escapeAttributeValue(message.from)}"`,
    `timestamp="${escapeAttributeValue(String(message.timestamp))}"`,
    `messageId="${escapeAttributeValue(message.messageId)}"`,
    `kind="${escapeAttributeValue(message.kind)}"`,
    `correlationId="${escapeAttributeValue(message.correlationId ?? "")}"`,
  ]
  if (message.summary !== undefined) {
    attributes.push(`summary="${escapeAttributeValue(message.summary)}"`)
  }
  if (message.references !== undefined) {
    attributes.push(`references="${escapeAttributeValue(JSON.stringify(message.references))}"`)
  }
  return `<peer_message ${attributes.join(" ")}>
${message.body}
</peer_message>`
}

function escapeAttributeValue(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll('"', "&quot;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll("'", "&apos;")
}
