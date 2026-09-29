// In-memory Slack workspace for the fake server: synthetic ids only.
export const FAKE_TEAM = "T000TEST"
export const FAKE_SELF = "U000GATEWAY"
export const FAKE_BOT_USER = "U000GWBOT"
export const FAKE_BOT_ID = "B000GWBOT"
export const FAKE_ALICE = "U000ALICE"
export const FAKE_OTHER_BOT = "U000OTHERBOT"
export const FAKE_CHAT = "C000TEST"
export const FAKE_DM = "D000ALICE"
export const FAKE_USER_TOKEN = "xoxc-fake-user-0000"
export const FAKE_COOKIE = "fake-session-cookie-0000"
export const FAKE_BOT_TOKEN = "xoxb-fake-bot-0000"
export const FAKE_APP_TOKEN = "xapp-fake-app-0000"
export const FAKE_WORKSPACE_URL = "https://fake-workspace.invalid/"

export type Caller = { kind: "user" | "bot" | "app"; user: string; bot_id: string | null }

export type FakeFile = {
  id: string
  name: string
  title: string
  mimetype: string
  bytes: Uint8Array
  subtype: string | null
  shared: { channel: string; ts: string } | null
}

export type FakeMessage = {
  channel: string
  ts: string
  user: string
  bot_id: string | null
  text: string
  blocks: unknown[] | null
  thread_ts: string | null
  subtype: string | null
  files: FakeFile[]
  metadata: { event_type: string; event_payload: unknown } | null
  reactions: Map<string, Set<string>>
  edited: { user: string; ts: string } | null
}

export const FAKE_USERS: Readonly<Record<string, { name: string; is_bot: boolean }>> = {
  [FAKE_SELF]: { name: "gateway", is_bot: false },
  [FAKE_BOT_USER]: { name: "gateway-app", is_bot: true },
  [FAKE_ALICE]: { name: "Alice", is_bot: false },
  [FAKE_OTHER_BOT]: { name: "other-gateway", is_bot: true },
}

type RichElement = { type?: unknown; text?: unknown; url?: unknown; user_id?: unknown; channel_id?: unknown; elements?: unknown }

function plainElements(elements: unknown): string {
  if (!Array.isArray(elements)) return ""
  return elements
    .map((raw: RichElement) => {
      if (raw === null || typeof raw !== "object") return ""
      if (raw.type === "text") return typeof raw.text === "string" ? raw.text : ""
      if (raw.type === "link") return typeof raw.text === "string" ? raw.text : typeof raw.url === "string" ? raw.url : ""
      if (raw.type === "user") return `@${String(raw.user_id)}`
      if (raw.type === "channel") return `#${String(raw.channel_id)}`
      return plainElements(raw.elements)
    })
    .join("")
}

export class FakeSlackState {
  readonly channels = new Map<string, { id: string; name: string; is_im: boolean; is_private: boolean }>([
    [FAKE_CHAT, { id: FAKE_CHAT, name: "gateway-test", is_im: false, is_private: false }],
    [FAKE_DM, { id: FAKE_DM, name: "alice", is_im: true, is_private: true }],
  ])
  readonly messages: FakeMessage[] = []
  readonly files = new Map<string, FakeFile>()
  /** per streamed message ts: the text shown after chat.startStream and after each chat.appendStream */
  readonly drafts = new Map<string, string[]>()
  /** streamed message ts values whose stream was closed by chat.stopStream */
  readonly stopped = new Set<string>()
  private lastMicros = 0
  private ids = 0

  nextTs(): string {
    this.lastMicros = Math.max(this.lastMicros + 1, Date.now() * 1000)
    return `${Math.floor(this.lastMicros / 1_000_000)}.${String(this.lastMicros % 1_000_000).padStart(6, "0")}`
  }

  nextId(prefix: string): string {
    this.ids += 1
    return `${prefix}000FAKE${this.ids}`
  }

  find(channel: string, ts: string): FakeMessage | undefined {
    return this.messages.find((message) => message.channel === channel && message.ts === ts)
  }

  add(input: Partial<FakeMessage> & { channel: string; user: string; text: string }): FakeMessage {
    const message: FakeMessage = {
      ts: this.nextTs(),
      bot_id: null,
      blocks: null,
      thread_ts: null,
      subtype: null,
      files: [],
      metadata: null,
      reactions: new Map(),
      edited: null,
      ...input,
    }
    this.messages.push(message)
    return message
  }

  isTopLevel(message: FakeMessage): boolean {
    return message.thread_ts === null || message.thread_ts === message.ts || message.subtype === "thread_broadcast"
  }

  plain(message: FakeMessage): string {
    if (message.blocks === null) return message.text
    return message.blocks.map((block) => (block !== null && typeof block === "object" && "elements" in block ? plainElements(block.elements) : "")).join("\n")
  }

  json(message: FakeMessage, withMetadata: boolean): Record<string, unknown> {
    return {
      type: "message",
      ts: message.ts,
      user: message.user,
      text: message.text,
      ...(message.bot_id === null ? {} : { bot_id: message.bot_id }),
      ...(message.blocks === null ? {} : { blocks: message.blocks }),
      ...(message.thread_ts === null ? {} : { thread_ts: message.thread_ts }),
      ...(message.subtype === null ? {} : { subtype: message.subtype }),
      ...(message.edited === null ? {} : { edited: message.edited }),
      ...(withMetadata && message.metadata !== null ? { metadata: message.metadata } : {}),
      ...(message.files.length === 0
        ? {}
        : {
            files: message.files.map((file) => ({
              id: file.id,
              name: file.name,
              title: file.title,
              mimetype: file.mimetype,
              size: file.bytes.byteLength,
              url_private: `${this.origin}/files/${file.id}`,
              ...(file.subtype === null ? {} : { subtype: file.subtype }),
            })),
          }),
      ...(message.reactions.size === 0 ? {} : { reactions: [...message.reactions.entries()].map(([name, users]) => ({ name, users: [...users], count: users.size })) }),
    }
  }

  origin = ""
}
