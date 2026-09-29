import type { ChatKind, InboundAuthor, InboundEvent, Platform, RichBody, SurfaceKey, UploadFile } from "../../adapter/contract"
import type { ConformanceFixtures } from "../../adapter/conformance/types"
import { plainText } from "../../adapter/rich"

export type FakeMessage = {
  message_id: string
  key: SurfaceKey
  text: string
  reactions: string[]
  uploads: string[]
  from_gateway: boolean
}

export type FakeHumanPost = { key: SurfaceKey; text: string; author?: InboundAuthor }

const HUMAN: InboundAuthor = { platform_user_id: "U000ALICE", display: "Alice", is_bot: false }

/**
 * An in-memory chat platform: chats, threads, messages, reactions, uploads and a human-side inbound
 * stream. The fake adapter runs on it, and an adapter author can back a local fake HTTP/WebSocket
 * server with it and reuse `fixtures()` for the conformance suite.
 */
export class FakePlatform {
  readonly platform: Platform
  readonly account_id: string
  readonly chat: SurfaceKey
  private seq = 0
  private readonly epoch = Date.now()
  private readonly messages = new Map<string, FakeMessage>()
  private readonly inbound: InboundEvent[] = []
  private readonly subscribers = new Set<(event: InboundEvent) => void>()
  private readonly archived = new Set<string>()

  constructor(options: { platform?: Platform; account_id?: string; chat_id?: string } = {}) {
    this.platform = options.platform ?? "slack"
    this.account_id = options.account_id ?? "T000TEST"
    this.chat = { platform: this.platform, account_id: this.account_id, chat_id: options.chat_id ?? "C000TEST", thread_id: null }
  }

  private next(prefix: string): string {
    this.seq += 1
    return `${prefix}${this.seq}`
  }

  private now(): string {
    return new Date(this.epoch + this.seq).toISOString()
  }

  private store(key: SurfaceKey, text: string, fromGateway: boolean): FakeMessage {
    const message: FakeMessage = { message_id: this.next("m"), key, text, reactions: [], uploads: [], from_gateway: fromGateway }
    this.messages.set(message.message_id, message)
    return message
  }

  permalink(message_id: string): string {
    return `https://fake.invalid/${this.platform}/${message_id}`
  }

  humanPost(input: FakeHumanPost): InboundEvent {
    const message = this.store(input.key, input.text, false)
    const event: InboundEvent = {
      event_id: `ev_${message.message_id}`,
      key: input.key,
      author: input.author ?? HUMAN,
      kind: input.key.thread_id === null ? "channel" : "thread_reply",
      reaction: null,
      edited: null,
      gateway_marker: false,
      text: input.text,
      transcript: null,
      attachments: [],
      reply_to: null,
      at: this.now(),
      permalink: this.permalink(message.message_id),
    }
    this.inbound.push(event)
    for (const subscriber of this.subscribers) subscriber(event)
    return event
  }

  subscribe(subscriber: (event: InboundEvent) => void): () => void {
    this.subscribers.add(subscriber)
    return () => this.subscribers.delete(subscriber)
  }

  inboundSince(since: string): readonly InboundEvent[] {
    return this.inbound.filter((event) => event.at > since)
  }

  post(key: SurfaceKey, body: RichBody): FakeMessage {
    return this.store(key, plainText(body), true)
  }

  edit(message_id: string, body: RichBody): FakeMessage {
    const message = this.messages.get(message_id)
    if (message === undefined || !message.from_gateway) throw new Error(`fake platform: no own message ${message_id}`)
    message.text = plainText(body)
    return message
  }

  react(message_id: string, name: string, on: boolean): void {
    const message = this.messages.get(message_id)
    if (message === undefined) throw new Error(`fake platform: no message ${message_id}`)
    message.reactions = message.reactions.filter((reaction) => reaction !== name)
    if (on) message.reactions.push(name)
  }

  upload(key: SurfaceKey, files: readonly UploadFile[], comment: RichBody | null): FakeMessage {
    const message = this.store(key, comment === null ? "" : plainText(comment), true)
    message.uploads = files.map((file) => file.title)
    return message
  }

  openThread(key: SurfaceKey, root: RichBody): { root: FakeMessage; thread: SurfaceKey } {
    const rootMessage = this.post(key, root)
    return { root: rootMessage, thread: { ...key, thread_id: this.next("th") } }
  }

  setArchived(key: SurfaceKey, archived: boolean): void {
    const id = `${key.chat_id}/${key.thread_id ?? ""}`
    if (archived) this.archived.add(id)
    else this.archived.delete(id)
  }

  isArchived(key: SurfaceKey): boolean {
    return this.archived.has(`${key.chat_id}/${key.thread_id ?? ""}`)
  }

  createChat(name: string, kind: ChatKind): SurfaceKey {
    return { ...this.chat, chat_id: this.next(kind === "topic" ? "TP" : "C"), thread_id: null }
  }

  message(key: SurfaceKey, message_id: string): FakeMessage | null {
    const message = this.messages.get(message_id)
    if (message === undefined) return null
    return message.key.chat_id === key.chat_id && message.key.thread_id === key.thread_id ? message : null
  }

  uploadsAt(key: SurfaceKey): readonly string[] {
    return [...this.messages.values()]
      .filter((message) => message.key.chat_id === key.chat_id && message.key.thread_id === key.thread_id)
      .flatMap((message) => message.uploads)
  }

  fixtures(): ConformanceFixtures {
    return {
      chat: this.chat,
      humanPost: async (input) => {
        this.humanPost(input)
      },
      readMessage: async (key, message_id) => this.message(key, message_id),
      readUploads: async (key) => this.uploadsAt(key),
      files: [
        { path: "/nonexistent/fake-a.txt", title: "first.txt" },
        { path: "/nonexistent/fake-b.txt", title: "second.txt" },
        { path: "/nonexistent/fake-c.txt", title: "third.txt" },
      ],
    }
  }
}
