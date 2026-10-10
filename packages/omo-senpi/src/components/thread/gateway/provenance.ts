import { GATEWAY_PROVENANCE_SENTENCE } from "./constants"
import type { DeliverySender } from "./adapter"
import type { DeliveryRow } from "./types"

function headerValue(value: string): string {
  const cleaned = value.replace(/[\s\[\]=]+/g, "_")
  return cleaned.length === 0 ? "-" : cleaned
}

/** A JSON string whose brackets are escaped too, so a quoted value can never close the `[...]` header. */
function quotedHeaderValue(value: string): string {
  return JSON.stringify(value).replace(/\[/g, "\\u005b").replace(/\]/g, "\\u005d")
}

function authorFields(row: DeliveryRow): string[] {
  const author = "external" in row.envelope.origin ? row.envelope.origin.external.author : undefined
  if (author === undefined) return []
  return [
    `author=${quotedHeaderValue(author.display)}`,
    `author_id=${quotedHeaderValue(author.platform_user_id)}`,
    ...(author.user_id === undefined ? [] : [`author_user_id=${quotedHeaderValue(author.user_id)}`]),
  ]
}

/** Who sent the delivery, as a human surface labels it: the header in the text stays the model's provenance. */
export function deliverySender(row: DeliveryRow): DeliverySender {
  const origin = row.envelope.origin
  if ("session" in origin) {
    const name = row.envelope.actor === origin.session ? undefined : row.envelope.actor
    return { kind: "agent", session_id: origin.session, ...(name === undefined ? {} : { name }) }
  }
  if (origin.external.platform === "cli") return { kind: "command_line", user: origin.external.account_id }
  const author = origin.external.author?.display
  return { kind: "external", platform: origin.external.platform, ...(author === undefined ? {} : { author }) }
}

export function renderDeliveryText(row: DeliveryRow): string {
  const envelope = row.envelope
  const source = "session" in envelope.origin ? "peer_agent" : "external"
  const senderSession = "session" in envelope.origin ? envelope.origin.session : "-"
  const effective = row.mode_effective ?? row.mode_requested
  const header = [
    "OMO_GATEWAY v=1",
    `source=${source}`,
    `actor=${headerValue(envelope.actor)}`,
    ...authorFields(row),
    `sender_session=${headerValue(senderSession)}`,
    `delivery=${headerValue(row.delivery_id)}`,
    `requested=${row.mode_requested}`,
    `effective=${effective}`,
    `root=${headerValue(envelope.root_id)}`,
    `hop=${envelope.hop}`,
    ...(row.binding_id === null ? [] : [`binding=${headerValue(row.binding_id)}@${row.binding_revision ?? 0}`]),
  ].join(" ")
  return `[${header}]\n${GATEWAY_PROVENANCE_SENTENCE}\n${JSON.stringify(row.body)}`
}
