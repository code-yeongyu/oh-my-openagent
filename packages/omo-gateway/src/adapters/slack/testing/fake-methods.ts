// Slack Web API methods of the fake server, answering with the response shapes Slack documents
// (ok/error envelope, ts strings, response_metadata cursors). conversations.replies returns the thread
// root first whatever `oldest` says, like the real API.
import { fail, p, parseBlocks, type MethodContext, type Reply } from "./fake-context"
import { fileMethod } from "./fake-files"
import {
  FAKE_BOT_ID,
  FAKE_TEAM,
  FAKE_USERS,
  FAKE_WORKSPACE_URL,
  type FakeMessage,
} from "./fake-state"

function page<T>(ctx: MethodContext, items: T[]): { items: T[]; next: string } {
  const limit = Number(p(ctx, "limit") || "100")
  const offset = Number(p(ctx, "cursor") || "0")
  const slice = items.slice(offset, offset + limit)
  return { items: slice, next: offset + limit < items.length ? String(offset + limit) : "" }
}

function metadataOf(ctx: MethodContext): FakeMessage["metadata"] | "refused" {
  const raw = p(ctx, "metadata")
  if (raw === "" || (ctx.caller.kind === "user" && !ctx.metadataFromUsers)) return null
  const parsed: unknown = JSON.parse(raw)
  return parsed !== null && typeof parsed === "object" && "event_type" in parsed && typeof parsed.event_type === "string"
    ? { event_type: parsed.event_type, event_payload: "event_payload" in parsed ? parsed.event_payload : null }
    : null
}

function post(ctx: MethodContext): Reply {
  const channel = p(ctx, "channel")
  if (!ctx.state.channels.has(channel)) return fail("channel_not_found")
  const blocks = parseBlocks(p(ctx, "blocks"))
  if (blocks === "invalid") return fail("invalid_blocks")
  const metadata = metadataOf(ctx)
  if (metadata === "refused") return fail("metadata_must_be_sent_from_app")
  const thread = p(ctx, "thread_ts")
  if (thread !== "" && ctx.state.find(channel, thread) === undefined) return fail("thread_not_found")
  const message = ctx.state.add({ channel, user: ctx.caller.user, bot_id: ctx.caller.bot_id, text: p(ctx, "text"), blocks, metadata, thread_ts: thread === "" ? null : thread })
  ctx.broadcast({ ...ctx.state.json(message, true), channel })
  return { ok: true, channel, ts: message.ts, message: ctx.state.json(message, true) }
}

function update(ctx: MethodContext): Reply {
  const channel = p(ctx, "channel")
  const message = ctx.state.find(channel, p(ctx, "ts"))
  if (message === undefined) return fail("message_not_found")
  if (message.user !== ctx.caller.user) return fail("cant_update_message")
  const blocks = parseBlocks(p(ctx, "blocks"))
  if (blocks === "invalid") return fail("invalid_blocks")
  const metadata = metadataOf(ctx)
  if (metadata === "refused") return fail("metadata_must_be_sent_from_app")
  message.text = p(ctx, "text")
  message.blocks = blocks
  message.edited = { user: ctx.caller.user, ts: ctx.state.nextTs() }
  ctx.broadcast({ type: "message", subtype: "message_changed", channel, ts: ctx.state.nextTs(), message: ctx.state.json(message, true) })
  return { ok: true, channel, ts: message.ts, text: message.text }
}

function react(ctx: MethodContext, add: boolean): Reply {
  const message = ctx.state.find(p(ctx, "channel"), p(ctx, "timestamp"))
  if (message === undefined) return fail("message_not_found")
  const name = p(ctx, "name")
  const users = message.reactions.get(name) ?? new Set<string>()
  if (add === users.has(ctx.caller.user)) return fail(add ? "already_reacted" : "no_reaction")
  if (add) users.add(ctx.caller.user)
  else users.delete(ctx.caller.user)
  if (users.size === 0) message.reactions.delete(name)
  else message.reactions.set(name, users)
  return { ok: true }
}

function history(ctx: MethodContext): Reply {
  const channel = p(ctx, "channel")
  if (!ctx.state.channels.has(channel)) return fail("channel_not_found")
  const oldest = Number(p(ctx, "oldest") || "0")
  const latest = Number(p(ctx, "latest") || "Infinity")
  const inclusive = p(ctx, "inclusive") === "true"
  const inRange = (ts: number) => (inclusive ? ts >= oldest && ts <= latest : ts > oldest && ts < latest)
  const all = ctx.state.messages.filter((m) => m.channel === channel && ctx.state.isTopLevel(m) && inRange(Number(m.ts))).reverse()
  const { items, next } = page(ctx, all)
  const meta = p(ctx, "include_all_metadata") === "true"
  return { ok: true, messages: items.map((m) => ctx.state.json(m, meta)), has_more: next !== "", response_metadata: { next_cursor: next } }
}

function replies(ctx: MethodContext): Reply {
  const channel = p(ctx, "channel")
  const root = ctx.state.find(channel, p(ctx, "ts"))
  if (root === undefined) return fail("thread_not_found")
  const oldest = Number(p(ctx, "oldest") || "0")
  const rest = ctx.state.messages.filter((m) => m.channel === channel && m.thread_ts === root.ts && m.ts !== root.ts && Number(m.ts) > oldest)
  const { items, next } = page(ctx, [root, ...rest])
  const meta = p(ctx, "include_all_metadata") === "true"
  return { ok: true, messages: items.map((m) => ctx.state.json(m, meta)), has_more: next !== "", response_metadata: { next_cursor: next } }
}

function search(ctx: MethodContext): Reply {
  if (ctx.caller.kind !== "user") return fail("not_allowed_token_type")
  const query = p(ctx, "query")
  const matches = ctx.state.messages
    .filter((m) => m.text.includes(query))
    .reverse()
    .slice(0, Number(p(ctx, "count") || "20"))
    .map((m) => ({
      ts: m.ts,
      text: m.text,
      user: m.user,
      channel: { id: m.channel },
      permalink: `${FAKE_WORKSPACE_URL}archives/${m.channel}/p${m.ts.replace(".", "")}${m.thread_ts !== null && m.thread_ts !== m.ts ? `?thread_ts=${m.thread_ts}` : ""}`,
    }))
  return { ok: true, messages: { matches } }
}

function stream(ctx: MethodContext, step: "start" | "append" | "stop"): Reply {
  if (ctx.caller.kind !== "bot") return fail("not_allowed_token_type")
  const channel = p(ctx, "channel")
  if (step === "start") {
    const thread = p(ctx, "thread_ts")
    if (thread === "" || ctx.state.find(channel, thread) === undefined) return fail("invalid_thread_ts")
    if (!channel.startsWith("D") && (p(ctx, "recipient_user_id") === "" || p(ctx, "recipient_team_id") === "")) return fail("missing_recipient_user_id")
    const message = ctx.state.add({ channel, user: ctx.caller.user, bot_id: FAKE_BOT_ID, text: p(ctx, "markdown_text"), thread_ts: thread })
    ctx.state.drafts.set(message.ts, message.text === "" ? [] : [message.text])
    return { ok: true, channel, ts: message.ts }
  }
  const message = ctx.state.find(channel, p(ctx, "ts"))
  if (message === undefined) return fail("message_not_found")
  const shown = ctx.state.drafts.get(message.ts)
  if (shown === undefined || ctx.state.stopped.has(message.ts)) return fail("message_not_in_streaming_state")
  message.text += p(ctx, "markdown_text")
  if (step === "append") shown.push(message.text)
  else ctx.state.stopped.add(message.ts)
  return { ok: true, channel, ts: message.ts }
}

export function callMethod(method: string, ctx: MethodContext): Reply {
  const { state, caller } = ctx
  if (caller.kind === "app" && method !== "apps.connections.open") return fail("not_allowed_token_type")
  if (method.startsWith("files.")) return fileMethod(method, ctx)
  switch (method) {
    case "auth.test":
      return { ok: true, url: FAKE_WORKSPACE_URL, team_id: FAKE_TEAM, user_id: caller.user, ...(caller.bot_id === null ? {} : { bot_id: caller.bot_id }) }
    case "rtm.connect":
      if (caller.kind !== "user") return fail("not_allowed_token_type")
      ctx.counters.rtmConnects += 1
      return { ok: true, url: `${ctx.origin.replace("http", "ws")}/rtm`, self: { id: caller.user }, team: { id: FAKE_TEAM } }
    case "apps.connections.open":
      if (caller.kind !== "app") return fail("not_allowed_token_type")
      ctx.counters.socketOpens += 1
      return { ok: true, url: `${ctx.origin.replace("http", "ws")}/socket` }
    case "users.info": {
      const user = FAKE_USERS[p(ctx, "user")]
      return user === undefined ? fail("user_not_found") : { ok: true, user: { id: p(ctx, "user"), name: user.name, real_name: user.name, is_bot: user.is_bot, profile: { display_name: user.name } } }
    }
    case "users.conversations": {
      const { items, next } = page(ctx, [...state.channels.values()])
      return { ok: true, channels: items.map((c) => ({ id: c.id, is_im: c.is_im })), response_metadata: { next_cursor: next } }
    }
    case "conversations.history":
      return history(ctx)
    case "conversations.replies":
      return replies(ctx)
    case "search.messages":
      return search(ctx)
    case "chat.postMessage":
      return post(ctx)
    case "chat.update":
      return update(ctx)
    case "chat.delete": {
      const index = state.messages.findIndex((m) => m.channel === p(ctx, "channel") && m.ts === p(ctx, "ts"))
      if (index < 0) return fail("message_not_found")
      state.messages.splice(index, 1)
      return { ok: true }
    }
    case "reactions.add":
      return react(ctx, true)
    case "reactions.remove":
      return react(ctx, false)
    case "conversations.create": {
      const id = state.nextId("C")
      state.channels.set(id, { id, name: p(ctx, "name"), is_im: false, is_private: p(ctx, "is_private") === "true" })
      return { ok: true, channel: { id, name: p(ctx, "name") } }
    }
    case "conversations.invite":
      return state.channels.has(p(ctx, "channel")) ? { ok: true } : fail("channel_not_found")
    case "assistant.threads.setStatus":
      if (caller.kind !== "bot") return fail("not_allowed_token_type")
      ctx.counters.statuses.push({ channel: p(ctx, "channel_id"), thread_ts: p(ctx, "thread_ts"), status: p(ctx, "status") })
      return { ok: true }
    case "chat.startStream":
      return stream(ctx, "start")
    case "chat.appendStream":
      return stream(ctx, "append")
    case "chat.stopStream":
      return stream(ctx, "stop")
    default:
      return fail("unknown_method")
  }
}
