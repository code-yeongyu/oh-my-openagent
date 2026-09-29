// The surface adapter contract: the one seam between gateway core and a chat platform.
//
// This file is published API (`@oh-my-opencode/omo-gateway/conformance` re-exports it) and is
// documented for adapter authors in docs/adapters.md. Core never sees a platform shape: message
// ids and timestamps are opaque strings, threading exists only as `thread_id` plus
// `capabilities.threads`, mentions and channels are ids plus an optional display name, and
// reactions use a neutral name each adapter maps to its platform.

/** Platforms a surface adapter can speak for; matches the `gateway` config schema enum. */
export type Platform = "slack" | "discord" | "telegram" | "notion" | "feishu"

/**
 * Where a message lives. The field names are the session-gateway binding fields
 * (platform, account_id, chat_id, thread_id). `account_id` is the gateway's own account on the
 * platform (workspace/bot/app id); `chat_id` is a DM, channel, group or page; `thread_id` is the
 * platform thread inside that chat, or null for the chat itself.
 */
export type SurfaceKey = { platform: Platform; account_id: string; chat_id: string; thread_id: string | null }

/** How an inbound event reached the gateway. */
export type InboundKind =
  /** a direct (1:1) message to the gateway's account */
  | "dm"
  /** a message that mentions the gateway's account */
  | "mention"
  /** a reply inside a platform thread (bound or not; the connector's `listen` filter decides) */
  | "thread_reply"
  /** a top-level message in a group chat or channel */
  | "channel"
  /** a reaction added to a message; `reaction` is set */
  | "reaction"
  /** a human changed an existing object (a message, a ticket field); `edited` is set */
  | "edit"

export type InboundAuthor = { platform_user_id: string; display: string; is_bot: boolean }
export type InboundAttachment = { name: string; url: string; mime: string; bytes: number }

export type InboundEvent = {
  /** platform-unique and stable across listen and catchUp replays: the dedupe key */
  event_id: string
  key: SurfaceKey
  author: InboundAuthor
  kind: InboundKind
  /**
   * set on a "mention" that reached the gateway only through a whole-chat mention (everyone in the
   * chat or channel was addressed, not the gateway's account by name); absent otherwise
   */
  broadcast?: true
  /** set exactly when kind is "reaction"; `name` is a gateway reaction name or a unicode emoji */
  reaction: { name: string; on_message_id: string } | null
  /** set exactly when kind is "edit": which object changed and, when the platform says, which field */
  edited: { object_id: string; field: string | null } | null
  /** the post carries another omo gateway's marker (loop guard) */
  gateway_marker: boolean
  /** message text; for a voice message with no transcript, the voice fallback text */
  text: string
  /** the voice transcript when an audio attachment was transcribed, else null */
  transcript: string | null
  attachments: readonly InboundAttachment[]
  reply_to: { message_id: string; author: string; text: string } | null
  /** ISO-8601 time the platform recorded the event */
  at: string
  permalink: string
}

/** What an adapter can do. Core reads this once per connection and downgrades what is false. */
export type Capabilities = {
  edit: boolean
  reactions: boolean
  typing: boolean
  threads: boolean
  thread_archive: boolean
  buttons: boolean
  /** the platform account can show one message growing as text arrives (in any platform way) */
  streaming: boolean
  /** the adapter carries `stream_draft` ops: a live draft preview, then one final message */
  draft_stream: boolean
  uploads: boolean
  rich_links: boolean
  /** the adapter can show the gateway account as online / present */
  presence: boolean
  /** the adapter can create chats (channels, topics, groups) through `create_chat` */
  chat_create: boolean
  /** longest text one post or edit may carry, counted on the plain rendering of the body */
  max_text: number
}

/** One inline piece of a message body. Platform-neutral; adapters render it natively. */
export type RichNode =
  | { t: "text"; text: string; bold?: true }
  | { t: "link"; url: string; label: string; bold?: true }
  | { t: "mention"; platform_user_id: string; display?: string }
  | { t: "channel"; chat_id: string; display?: string }

export type RichBody = readonly RichNode[]

export type UploadFile = { path: string; title: string }

export type ChatKind = "channel" | "topic" | "group"

/** An outbound operation, already presented and gated by core. */
export type RenderedOp =
  | { op: "post"; key: SurfaceKey; body: RichBody }
  | { op: "edit"; key: SurfaceKey; message_id: string; body: RichBody }
  | { op: "react" | "unreact"; key: SurfaceKey; message_id: string; name: string }
  | { op: "typing"; key: SurfaceKey }
  | { op: "upload"; key: SurfaceKey; files: readonly UploadFile[]; comment: RichBody | null }
  | { op: "open_thread"; key: SurfaceKey; root: RichBody }
  | { op: "archive_thread" | "reopen_thread"; key: SurfaceKey }
  | {
      op: "create_chat"
      key: Omit<SurfaceKey, "chat_id" | "thread_id">
      name: string
      kind: ChatKind
      members?: readonly string[]
    }
  /**
   * Show `text` as the live draft `draft_id` at `key` (`final: false`, posts nothing), or post the
   * finished message that replaces the draft (`final: true`). Needs `draft_stream`.
   */
  | { op: "stream_draft"; key: SurfaceKey; draft_id: string; text: string; final: boolean }

/**
 * What `send` returns. `message_id` is the platform id of the posted/edited/root message (an
 * empty string for ops that post nothing: typing, reactions, archive, a non-final draft). `created` is the key of the
 * thread `open_thread` opened or the chat `create_chat` created, and null for every other op.
 */
export type SendResult = { message_id: string; permalink: string; created: SurfaceKey | null }

export interface SurfaceAdapter {
  readonly platform: Platform
  capabilities(): Capabilities
  /**
   * Realtime events; resolves when `signal` aborts. Call `ready` once the platform connection is
   * live: core runs catchUp after it to close the gap between connecting and listening.
   */
  listen(onEvent: (e: InboundEvent) => void, signal: AbortSignal, ready: () => void): Promise<void>
  /** backstop on (re)connect and on an interval: every event after `since` in the listened chats and in `threads` */
  catchUp(since: string, threads: readonly SurfaceKey[]): AsyncIterable<InboundEvent>
  send(op: RenderedOp): Promise<SendResult>
}

/**
 * Gateway reaction names. Core uses these (or a literal unicode emoji); each adapter maps a name
 * to its platform's reaction, falling back to `GATEWAY_REACTION_EMOJI`.
 */
export const GATEWAY_REACTIONS = [
  "seen",
  "working",
  "done",
  "failed",
  "waiting",
  "question",
  "number_1",
  "number_2",
  "number_3",
  "number_4",
  "number_5",
  "number_6",
  "number_7",
  "number_8",
  "number_9",
] as const

export type GatewayReaction = (typeof GATEWAY_REACTIONS)[number]

export const GATEWAY_REACTION_EMOJI: Readonly<Record<GatewayReaction, string>> = {
  seen: "\u{1F440}",
  working: "\u{23F3}",
  done: "\u{2705}",
  failed: "\u{274C}",
  waiting: "\u{23F8}\u{FE0F}",
  question: "\u{2753}",
  number_1: "1\u{FE0F}\u{20E3}",
  number_2: "2\u{FE0F}\u{20E3}",
  number_3: "3\u{FE0F}\u{20E3}",
  number_4: "4\u{FE0F}\u{20E3}",
  number_5: "5\u{FE0F}\u{20E3}",
  number_6: "6\u{FE0F}\u{20E3}",
  number_7: "7\u{FE0F}\u{20E3}",
  number_8: "8\u{FE0F}\u{20E3}",
  number_9: "9\u{FE0F}\u{20E3}",
}

/** The boolean capability an op needs, or "max_text" when its body is too long. */
export type RefusedCapability = Exclude<keyof Capabilities, "max_text"> | "max_text"

/**
 * Thrown by `send` (and returned by `checkCapability`) when an op needs something the adapter
 * reported it cannot do. Refusing is the honest answer; silently dropping the op is not.
 */
export class AdapterRefusal extends Error {
  readonly capability: RefusedCapability
  readonly op: RenderedOp["op"]

  constructor(op: RenderedOp["op"], capability: RefusedCapability, reason: string) {
    super(reason)
    this.name = "AdapterRefusal"
    this.op = op
    this.capability = capability
  }
}

/**
 * Thrown by `listen`, `catchUp` or `send` when the platform refused the account itself: a revoked,
 * expired or invalid credential, or another client that owns the account. Retrying cannot help, so
 * the connector stops that connector, tells the scope owner once, and starts it again only when the
 * gateway config or the credential file changes. `reason` is the platform's own code (for example
 * `invalid_auth`, `401`, `close 4004`); neither it nor the message ever carries a secret.
 */
export class AdapterFatal extends Error {
  readonly platform: Platform
  readonly reason: string

  constructor(platform: Platform, reason: string, message: string) {
    super(message)
    this.name = "AdapterFatal"
    this.platform = platform
    this.reason = reason
  }
}
