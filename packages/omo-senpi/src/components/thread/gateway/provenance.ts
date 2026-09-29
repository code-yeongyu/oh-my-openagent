import { GATEWAY_PROVENANCE_SENTENCE } from "./constants"
import type { DeliveryRow } from "./types"

function headerValue(value: string): string {
  const cleaned = value.replace(/[\s\[\]=]+/g, "_")
  return cleaned.length === 0 ? "-" : cleaned
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
