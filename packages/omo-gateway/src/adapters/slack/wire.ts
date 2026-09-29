// Defensive parsers for the Slack shapes the adapter reads (RTM frames, Events API payloads, Web API
// history). Anything that does not fit is null, never a throw: a malformed event is dropped with a
// log line by the caller.

export type Json = { readonly [key: string]: unknown }

export function isJson(value: unknown): value is Json {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

const str = (value: unknown): string | null => (typeof value === "string" && value !== "" ? value : null)
const TS = /^\d{1,12}\.\d{1,9}$/

export function isTs(value: unknown): value is string {
  return typeof value === "string" && TS.test(value)
}

export type SlackFile = { id: string; name: string; mime: string; bytes: number; url: string; subtype: string | null }

export type SlackMessage = {
  channel: string
  ts: string
  user: string | null
  bot_id: string | null
  username: string | null
  text: string
  thread_ts: string | null
  subtype: string | null
  hidden: boolean
  files: readonly SlackFile[]
  marker_event_type: string | null
  edited_ts: string | null
}

export type SlackReaction = { user: string; name: string; channel: string; ts: string; event_ts: string }

function parseFile(raw: unknown): SlackFile | null {
  if (!isJson(raw)) return null
  const id = str(raw.id)
  if (id === null) return null
  return {
    id,
    name: str(raw.name) ?? str(raw.title) ?? id,
    mime: str(raw.mimetype) ?? "application/octet-stream",
    bytes: typeof raw.size === "number" && raw.size >= 0 ? raw.size : 0,
    url: str(raw.url_private_download) ?? str(raw.url_private) ?? "",
    subtype: str(raw.subtype),
  }
}

/** A message from an RTM/Events frame or a history page; `channel` fills in when the shape has none. */
export function parseMessage(raw: unknown, channel?: string): SlackMessage | null {
  if (!isJson(raw)) return null
  const where = str(raw.channel) ?? channel ?? null
  if (where === null || !isTs(raw.ts)) return null
  const metadata = isJson(raw.metadata) ? raw.metadata : null
  const edited = isJson(raw.edited) && isTs(raw.edited.ts) ? raw.edited.ts : null
  return {
    channel: where,
    ts: raw.ts,
    user: str(raw.user),
    bot_id: str(raw.bot_id),
    username: str(raw.username) ?? (isJson(raw.bot_profile) ? str(raw.bot_profile.name) : null),
    text: typeof raw.text === "string" ? raw.text : "",
    thread_ts: isTs(raw.thread_ts) ? raw.thread_ts : null,
    subtype: str(raw.subtype),
    hidden: raw.hidden === true,
    files: (Array.isArray(raw.files) ? raw.files : []).flatMap((file) => parseFile(file) ?? []),
    marker_event_type: metadata === null ? null : str(metadata.event_type),
    edited_ts: edited,
  }
}

/** `message_changed`: the new message (with its channel) or null. */
export function parseChanged(raw: Json): SlackMessage | null {
  const channel = str(raw.channel)
  return channel === null ? null : parseMessage(raw.message, channel)
}

export function parseReaction(raw: unknown): SlackReaction | null {
  if (!isJson(raw) || !isJson(raw.item) || raw.item.type !== "message") return null
  const user = str(raw.user)
  const name = str(raw.reaction)
  const channel = str(raw.item.channel)
  const ts = raw.item.ts
  if (user === null || name === null || channel === null || !isTs(ts)) return null
  return { user, name, channel, ts, event_ts: isTs(raw.event_ts) ? raw.event_ts : ts }
}

export function tsToIso(ts: string): string {
  return new Date(Math.round(Number(ts) * 1000)).toISOString()
}

/** An ISO time as a Slack `oldest` bound: seconds with microseconds. */
export function isoToTs(iso: string): string {
  const ms = Date.parse(iso)
  return ((Number.isNaN(ms) ? 0 : ms) / 1000).toFixed(6)
}

export function tsAfter(ts: string, bound: string): boolean {
  return Number(ts) > Number(bound)
}
