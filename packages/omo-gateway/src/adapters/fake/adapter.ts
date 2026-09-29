import { checkCapability } from "../../adapter/capability"
import { AdapterRefusal, type Capabilities, InboundEvent, Platform, RenderedOp, SendResult, SurfaceAdapter, SurfaceKey } from "../../adapter/contract"
import { FakePlatform } from "./platform"

export const FAKE_DEFAULT_CAPABILITIES: Capabilities = {
  edit: true,
  reactions: true,
  typing: true,
  threads: true,
  thread_archive: true,
  buttons: true,
  streaming: true,
  draft_stream: false,
  uploads: true,
  rich_links: true,
  presence: true,
  chat_create: true,
  max_text: 4000,
}

export type FakeAdapterOptions = { platform?: FakePlatform; capabilities?: Partial<Capabilities> }

/** The in-memory adapter: every op is recorded in `ops`, refused honestly per its capabilities, and applied to its FakePlatform. */
export class FakeAdapter implements SurfaceAdapter {
  readonly platform: Platform
  readonly fake: FakePlatform
  readonly ops: RenderedOp[] = []
  private readonly caps: Capabilities

  constructor(options: FakeAdapterOptions = {}) {
    this.fake = options.platform ?? new FakePlatform()
    this.platform = this.fake.platform
    this.caps = { ...FAKE_DEFAULT_CAPABILITIES, ...options.capabilities }
  }

  capabilities(): Capabilities {
    return { ...this.caps }
  }

  async listen(onEvent: (e: InboundEvent) => void, signal: AbortSignal, ready: () => void): Promise<void> {
    if (signal.aborted) return
    const unsubscribe = this.fake.subscribe(onEvent)
    ready()
    await new Promise<void>((resolve) => signal.addEventListener("abort", () => resolve(), { once: true }))
    unsubscribe()
  }

  async *catchUp(since: string, threads: readonly SurfaceKey[]): AsyncIterable<InboundEvent> {
    const watched = new Set(threads.map((key) => `${key.chat_id}/${key.thread_id}`))
    for (const event of this.fake.inboundSince(since)) {
      if (event.key.thread_id === null || watched.has(`${event.key.chat_id}/${event.key.thread_id}`)) yield event
    }
  }

  async send(op: RenderedOp): Promise<SendResult> {
    this.ops.push(op)
    const refusal = checkCapability(this.platform, this.caps, op)
    if (refusal !== null) throw refusal
    const fake = this.fake
    const done = (message_id: string, created: SurfaceKey | null = null): SendResult => ({
      message_id,
      permalink: message_id === "" ? "" : fake.permalink(message_id),
      created,
    })
    switch (op.op) {
      case "post":
        return done(fake.post(op.key, op.body).message_id)
      case "edit":
        return done(fake.edit(op.message_id, op.body).message_id)
      case "react":
      case "unreact":
        fake.react(op.message_id, op.name, op.op === "react")
        return done("")
      case "typing":
        return done("")
      case "upload":
        return done(fake.upload(op.key, op.files, op.comment).message_id)
      case "open_thread": {
        const opened = fake.openThread(op.key, op.root)
        return done(opened.root.message_id, opened.thread)
      }
      case "archive_thread":
      case "reopen_thread":
        fake.setArchived(op.key, op.op === "archive_thread")
        return done("")
      case "create_chat":
        return done("", fake.createChat(op.name, op.kind))
      case "stream_draft":
        throw new AdapterRefusal("stream_draft", "draft_stream", "the fake platform has no message drafts")
    }
  }
}
