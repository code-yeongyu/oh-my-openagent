// The rendered text of a gateway delivery as the receiving model reads it (gateway/provenance.ts renderDeliveryText):
// the provenance line ending in the `[OMO_GATEWAY v=1 ...]` header, the provenance sentence, then the body as JSON.
// `effective=` in the header is the lane the delivery took: `start`, `steer` or `follow_up` (#14333).
const DELIVERY_PATTERN = /^(?:[^\n[]*? )?\[OMO_GATEWAY v=1(?: ([^\]]*))?\]\n[^\n]*\n([\s\S]*)$/
// A header field: a bare token, or a JSON string (its brackets escaped by the renderer, so it never closes the header).
const FIELD_PATTERN = /([A-Za-z_]+)=("(?:[^"\\]|\\.)*"|\S+)/g

function fieldValue(raw) {
  if (!raw.startsWith('"')) return raw
  try {
    return JSON.parse(raw)
  } catch {
    return raw
  }
}

/** A delivery's rendered text split into its header fields and the sender's own text. */
export function parseDeliveryText(text) {
  const match = DELIVERY_PATTERN.exec(text)
  if (match === null) return undefined
  const header = Object.fromEntries(
    [...(match[1] ?? "").matchAll(FIELD_PATTERN)].map(([, key, value]) => [key, fieldValue(value)]),
  )
  let body = match[2]
  try {
    body = JSON.parse(match[2])
  } catch {
    // An unparseable body stays the raw text.
  }
  return { header, body: typeof body === "string" ? body : JSON.stringify(body) }
}
