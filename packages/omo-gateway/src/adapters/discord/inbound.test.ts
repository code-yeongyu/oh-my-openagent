import { afterEach, describe, expect, test } from "bun:test"
import type { InboundEvent } from "../../adapter/contract"
import { createTranscriber, NO_TRANSCRIPT } from "../../stt/transcribe"
import { FakeDiscordServer } from "./testing/fake-server"
import { FAKE_BOT, FAKE_CHAT, FAKE_DM, FAKE_GUILD } from "./testing/fake-state"
import { adapterFor, startListening, type Listening } from "./testing/harness"

const AUDIO = new Uint8Array([0x4f, 0x67, 0x67, 0x53, 9, 8, 7])
const servers: { stop(): void }[] = []
const listeners: Listening[] = []
afterEach(async () => {
  for (const listener of listeners.splice(0)) await listener.stop()
  for (const server of servers.splice(0)) server.stop()
})

function fakeStt() {
  const seen: { bytes: Uint8Array | null; filename: string | null } = { bytes: null, filename: null }
  const server = Bun.serve({
    port: 0,
    hostname: "127.0.0.1",
    async fetch(request) {
      const path = new URL(request.url).pathname
      if (request.method === "POST" && path === "/files") {
        const file = (await request.formData()).get("file")
        if (file instanceof File) {
          seen.bytes = new Uint8Array(await file.arrayBuffer())
          seen.filename = file.name
        }
        return Response.json({ id: "file_1" })
      }
      if (request.method === "DELETE") return Response.json({})
      if (path === "/transcriptions") return Response.json({ id: "job_1" })
      if (path === "/transcriptions/job_1") return Response.json({ status: "completed" })
      if (path === "/transcriptions/job_1/transcript") return Response.json({ text: "ship the fix today" })
      return new Response("no", { status: 404 })
    },
  })
  servers.push({ stop: () => server.stop(true) })
  return { baseUrl: `http://127.0.0.1:${server.port}`, seen }
}

async function listen(overrides: Parameters<typeof adapterFor>[1] = {}) {
  const server = new FakeDiscordServer()
  servers.push(server)
  const adapter = adapterFor(server, overrides)
  const listening = startListening(adapter)
  listeners.push(listening)
  await listening.ready
  return { server, adapter, listening }
}

const voice = { filename: "voice-message.ogg", content_type: "audio/ogg", bytes: AUDIO }

describe("discord adapter inbound events", () => {
  test("a voice message gets its transcript from the STT provider", async () => {
    const stt = fakeStt()
    const transcriber = createTranscriber({ stt: { provider: "soniox", credentials_env: "K" }, env: { K: "test-key" }, baseUrl: stt.baseUrl, pollIntervalMs: 0 })
    const { server, listening } = await listen({ transcriber })
    server.humanPost({ channel_id: FAKE_CHAT, content: "", flags: 1 << 13, attachments: [voice] })
    const event = await listening.waitForEvent((e) => e.attachments.length === 1, "the voice message")
    expect(event.transcript).toBe("ship the fix today")
    expect(event.text).toBe("ship the fix today")
    expect(stt.seen.bytes).toEqual(AUDIO)
    expect(stt.seen.filename).toBe("voice-message.ogg")
    expect(event.attachments[0]).toMatchObject({ name: "voice-message.ogg", mime: "audio/ogg", bytes: AUDIO.length })
  })

  test("a voice message with no gateway.stt carries the no-transcript fallback", async () => {
    const { server, listening } = await listen()
    server.humanPost({ channel_id: FAKE_CHAT, content: "", attachments: [voice] })
    const event = await listening.waitForEvent((e) => e.attachments.length === 1, "the voice message")
    expect(event).toMatchObject({ text: NO_TRANSCRIPT, transcript: null })
  })

  test("kinds: DM, mention, channel post, and bot authors flagged; the gateway's own posts never arrive", async () => {
    const { server, adapter, listening } = await listen()
    await adapter.send({ op: "post", key: server.chat, body: [{ t: "text", text: "own post" }] })
    server.humanPost({ channel_id: FAKE_DM, content: "dm text" })
    server.humanPost({ channel_id: FAKE_CHAT, content: `<@${FAKE_BOT.id}> look` })
    server.humanPost({ channel_id: FAKE_CHAT, content: "relay", author: { id: "900000000000000001", username: "relay-bot", global_name: null, bot: true } })
    server.humanPost({ channel_id: FAKE_CHAT, content: "plain" })
    await listening.waitForEvent((e) => e.text === "plain", "the last post")
    const byText = (text: string): InboundEvent | undefined => listening.events.find((e) => e.text === text)
    expect(byText("dm text")).toMatchObject({ kind: "dm", key: { chat_id: FAKE_DM, thread_id: null } })
    expect(byText("dm text")?.permalink).toStartWith("https://discord.com/channels/@me/")
    expect(byText(`<@${FAKE_BOT.id}> look`)?.kind).toBe("mention")
    expect(byText("relay")?.author.is_bot).toBe(true)
    expect(byText("plain")).toMatchObject({ kind: "channel", author: { display: "Alice", is_bot: false } })
    expect(byText("plain")?.permalink).toStartWith(`https://discord.com/channels/${FAKE_GUILD}/${FAKE_CHAT}/`)
    expect(listening.events.some((e) => e.text === "own post")).toBe(false)
  })

  test("thread replies carry the parent chat and thread id: via THREAD_CREATE, THREAD_LIST_SYNC and the REST fallback", async () => {
    const { server, adapter, listening } = await listen()
    const opened = await adapter.send({ op: "open_thread", key: server.chat, root: [{ t: "text", text: "root" }] })
    const viaCreate = opened.created?.thread_id ?? ""
    const unseen = server.state.addChannel({ type: 11, guild_id: FAKE_GUILD, parent_id: FAKE_CHAT, name: "made before listen" })
    server.gateway.broadcast("THREAD_LIST_SYNC", { guild_id: FAKE_GUILD, threads: [{ id: "500000000000000009", type: 11, parent_id: FAKE_CHAT, guild_id: FAKE_GUILD }] })
    server.humanPost({ channel_id: viaCreate, content: "in created thread" })
    server.humanPost({ channel_id: unseen.id, content: "in unseen thread" })
    server.humanPost({ channel_id: "500000000000000009", content: "in synced thread" })
    await listening.waitForEvent((e) => e.text === "in synced thread", "the synced-thread reply")
    for (const [textValue, thread] of [
      ["in created thread", viaCreate],
      ["in unseen thread", unseen.id],
      ["in synced thread", "500000000000000009"],
    ] as const) {
      expect(listening.events.find((e) => e.text === textValue)).toMatchObject({ kind: "thread_reply", key: { chat_id: FAKE_CHAT, thread_id: thread } })
    }
  })

  test("MESSAGE_REACTION_ADD arrives as kind reaction under the gateway reaction name", async () => {
    const { server, adapter, listening } = await listen()
    const posted = await adapter.send({ op: "post", key: server.chat, body: [{ t: "text", text: "pick one" }] })
    server.humanReact(FAKE_CHAT, posted.message_id, "2\u{FE0F}\u{20E3}")
    server.humanReact(FAKE_CHAT, posted.message_id, "\u{1F389}")
    const numbered = await listening.waitForEvent((e) => e.reaction?.name === "number_2", "the number_2 reaction")
    expect(numbered).toMatchObject({ kind: "reaction", reaction: { on_message_id: posted.message_id }, author: { is_bot: false } })
    const party = await listening.waitForEvent((e) => e.reaction?.name === "\u{1F389}", "the unmapped emoji reaction")
    expect(party.event_id).not.toBe(numbered.event_id)
  })
})

describe("discord adapter catchUp", () => {
  test("pages through GET /channels/{id}/messages?after= oldest first, 150 messages, stable ids", async () => {
    const server = new FakeDiscordServer()
    servers.push(server)
    const since = new Date(Date.now() - 60_000).toISOString()
    for (let index = 0; index < 150; index += 1) server.state.addMessage({ channel_id: FAKE_CHAT, author: { id: "200000000000000001", username: "alice", global_name: null, bot: false }, content: `m${index}` })
    const events: InboundEvent[] = []
    for await (const event of adapterFor(server).catchUp(since, [])) events.push(event)
    expect(events.map((event) => event.text)).toEqual(Array.from({ length: 150 }, (_, index) => `m${index}`))
    expect(server.rest.requests.filter((request) => request.path.startsWith(`/channels/${FAKE_CHAT}/messages`))).toHaveLength(2)
    const again: string[] = []
    for await (const event of adapterFor(server).catchUp(since, [])) again.push(event.event_id)
    expect(again).toEqual(events.map((event) => event.event_id))
  })

  test("threads passed to catchUp are read with their parent chat in the key; an unreadable channel is skipped with a log", async () => {
    const server = new FakeDiscordServer()
    servers.push(server)
    const thread = server.state.addChannel({ type: 11, guild_id: FAKE_GUILD, parent_id: FAKE_CHAT, name: "t" })
    server.state.addMessage({ channel_id: thread.id, author: { id: "200000000000000001", username: "alice", global_name: null, bot: false }, content: "reply in thread" })
    const logs: string[] = []
    const events: InboundEvent[] = []
    const adapter = adapterFor(server, { chats: ["999999999999999999"] }, logs)
    for await (const event of adapter.catchUp(new Date(Date.now() - 60_000).toISOString(), [{ ...server.chat, thread_id: thread.id }])) events.push(event)
    expect(events).toHaveLength(1)
    expect(events[0]).toMatchObject({ kind: "thread_reply", key: { chat_id: FAKE_CHAT, thread_id: thread.id } })
    expect(logs.some((line) => line.includes("catchUp skipped channel 999999999999999999"))).toBe(true)
  })
})
