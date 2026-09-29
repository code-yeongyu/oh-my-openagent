import type { ConformanceFixtures } from "../../../adapter/conformance/types"
import type { SurfaceKey, UploadFile } from "../../../adapter/contract"
import { reactionName } from "../render"
import { FakeDiscordGateway, type SocketData } from "./fake-gateway"
import { FakeDiscordRest } from "./fake-rest"
import { FAKE_ALICE, FAKE_BOT, FAKE_CHAT, FAKE_GUILD, FakeDiscordState, type FakeAttachment, type FakeMessage, type FakeUser } from "./fake-state"

export const FAKE_TOKEN = "fake-bot-token-0000"

export type FakeHumanMessage = {
  channel_id: string
  content: string
  author?: FakeUser
  flags?: number
  attachments?: readonly { filename: string; content_type: string; bytes: Uint8Array }[]
}

/** A local Discord (REST v10 + gateway) on `Bun.serve` port 0, for the adapter tests and the fake QA run. */
export class FakeDiscordServer {
  readonly state = new FakeDiscordState()
  readonly gateway: FakeDiscordGateway
  readonly rest: FakeDiscordRest
  private readonly server: ReturnType<typeof Bun.serve<SocketData>>
  private sockets = 0

  constructor() {
    this.gateway = new FakeDiscordGateway({
      token: FAKE_TOKEN,
      resumeUrl: () => this.gatewayUrl,
      readyPayload: (session_id) => ({ v: 10, session_id, resume_gateway_url: this.gatewayUrl, user: FAKE_BOT, guilds: [{ id: FAKE_GUILD, unavailable: true }] }),
      guildCreate: () => ({
        id: FAKE_GUILD,
        channels: [...this.state.channels.values()].filter((c) => c.guild_id === FAKE_GUILD && c.parent_id === null).map((c) => this.state.channelJson(c)),
        threads: [...this.state.channels.values()].filter((c) => c.parent_id !== null && !c.archived).map((c) => this.state.channelJson(c)),
      }),
    })
    this.rest = new FakeDiscordRest(this.state, FAKE_TOKEN, () => this.origin, (t, d) => this.gateway.broadcast(t, d))
    this.server = Bun.serve<SocketData>({
      port: 0,
      hostname: "127.0.0.1",
      fetch: (request, server) => {
        const path = new URL(request.url).pathname
        if (path.startsWith("/gateway")) {
          this.sockets += 1
          return server.upgrade(request, { data: { socket: this.sockets, session: null } }) ? undefined : new Response("upgrade failed", { status: 400 })
        }
        const attachment = /^\/attachments\/(\d+)\/(\d+)\//.exec(path)
        if (attachment !== null) return this.rest.attachment(attachment[1] ?? "", attachment[2] ?? "")
        if (path.startsWith("/api/v10/")) return this.rest.handle(request, path.slice("/api/v10".length))
        return new Response("not found", { status: 404 })
      },
      websocket: {
        open: (ws) => this.gateway.open(ws),
        message: (ws, message) => this.gateway.message(ws, message),
        close: (ws, code) => this.gateway.close(ws, code),
      },
    })
  }

  get origin(): string {
    return `http://127.0.0.1:${this.server.port}`
  }

  get apiBase(): string {
    return `${this.origin}/api/v10`
  }

  get gatewayUrl(): string {
    return `ws://127.0.0.1:${this.server.port}/gateway`
  }

  get chat(): SurfaceKey {
    return { platform: "discord", account_id: FAKE_BOT.id, chat_id: FAKE_CHAT, thread_id: null }
  }

  humanPost(input: FakeHumanMessage): FakeMessage {
    const attachments: FakeAttachment[] = (input.attachments ?? []).map((file) => ({ ...file, id: this.state.snowflake() }))
    const message = this.state.addMessage({ channel_id: input.channel_id, author: input.author ?? FAKE_ALICE, content: input.content, flags: input.flags ?? 0, attachments })
    this.rest.publish(message)
    return message
  }

  humanReact(channel_id: string, message_id: string, emoji: string, user: FakeUser = FAKE_ALICE): void {
    const guild_id = this.state.channels.get(channel_id)?.guild_id ?? null
    this.gateway.broadcast("MESSAGE_REACTION_ADD", {
      user_id: user.id,
      channel_id,
      message_id,
      ...(guild_id === null ? {} : { guild_id, member: { user } }),
      emoji: { id: null, name: emoji },
    })
  }

  fixtures(files: readonly UploadFile[]): ConformanceFixtures {
    const target = (key: SurfaceKey) => key.thread_id ?? key.chat_id
    return {
      chat: this.chat,
      humanPost: async ({ key, text }) => {
        this.humanPost({ channel_id: target(key), content: text })
      },
      readMessage: async (key, message_id) => {
        const message = this.state.messages.get(message_id)
        if (message === undefined || message.channel_id !== target(key)) return null
        const reactions = [...message.reactions.entries()].filter(([, users]) => users.has(FAKE_BOT.id)).map(([emoji]) => reactionName({ id: null, name: emoji }))
        return { text: message.content, reactions }
      },
      readUploads: async (key) => this.state.inChannel(target(key)).flatMap((message) => message.attachments.map((attachment) => attachment.filename)),
      files,
      timeoutMs: 5000,
    }
  }

  stop(): void {
    this.server.stop(true)
  }
}
