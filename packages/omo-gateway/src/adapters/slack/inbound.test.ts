import { afterEach, beforeEach, expect, test } from "bun:test"
import type { InboundEvent } from "../../adapter/contract"
import { NO_TRANSCRIPT } from "../../stt/transcribe"
import { GATEWAY_MARKER_EVENT } from "./events"
import { FakeSlackServer } from "./testing/fake-server"
import { FAKE_CHAT, FAKE_DM, FAKE_OTHER_BOT, FAKE_SELF } from "./testing/fake-state"
import { adapterFor, startListening } from "./testing/harness"

let server: FakeSlackServer

beforeEach(() => {
  server = new FakeSlackServer()
})

afterEach(() => {
  server.stop()
})

const byText = (text: string) => (event: InboundEvent) => event.text === text

test("@here, @channel and @everyone are mentions of the channel: kind mention with the broadcast flag; a named mention is not a broadcast", async () => {
  const adapter = adapterFor(server)
  const listening = startListening(adapter)
  await listening.ready
  const root = server.humanPost({ channel: FAKE_CHAT, text: "thread root" })
  const texts = ["<!here> standup in 5", "<!channel|channel> deploy freeze", "<!everyone> all hands", `<@${FAKE_SELF}> and <!here> please`, "no mention at all"]
  server.humanPost({ channel: FAKE_CHAT, text: texts[0] ?? "" })
  server.humanPost({ channel: FAKE_CHAT, text: texts[1] ?? "", thread_ts: root.ts })
  for (const text of texts.slice(2)) server.humanPost({ channel: FAKE_CHAT, text })
  await listening.waitFor(byText("no mention at all"), "the last post")
  await listening.stop()
  const seen = texts.map((text) => {
    const event = listening.events.find(byText(text))
    return [event?.kind, event?.broadcast ?? null]
  })
  expect(seen).toEqual([
    ["mention", true],
    ["mention", true],
    ["mention", true],
    ["mention", null],
    ["channel", null],
  ])
  expect(listening.events.find(byText("<!channel|channel> deploy freeze"))?.key.thread_id).toBe(root.ts)
})

test("kinds: DM, mention, thread reply and channel post; own posts never arrive; other bots arrive as bots", async () => {
  const adapter = adapterFor(server)
  const listening = startListening(adapter)
  await listening.ready
  const root = server.humanPost({ channel: FAKE_CHAT, text: "top level" })
  server.humanPost({ channel: FAKE_DM, text: "direct" })
  server.humanPost({ channel: FAKE_CHAT, text: `hey <@${FAKE_SELF}> look` })
  server.humanPost({ channel: FAKE_CHAT, text: "in the thread", thread_ts: root.ts })
  await adapter.send({ op: "post", key: server.chat(), body: [{ t: "text", text: "the gateway itself" }] })
  server.humanPost({ channel: FAKE_CHAT, text: "from another gateway", user: FAKE_OTHER_BOT, bot_id: "B000OTHER", marker: GATEWAY_MARKER_EVENT })
  const last = await listening.waitFor(byText("from another gateway"), "the other bot's post")
  await listening.stop()
  const kind = (text: string) => listening.events.find(byText(text))?.kind
  expect([kind("top level"), kind("direct"), kind(`hey <@${FAKE_SELF}> look`), kind("in the thread")]).toEqual(["channel", "dm", "mention", "thread_reply"])
  expect(listening.events.find(byText("in the thread"))?.key.thread_id).toBe(root.ts)
  expect(listening.events.find(byText("top level"))).toMatchObject({ event_id: `${FAKE_CHAT}:${root.ts}`, key: { thread_id: null }, author: { display: "Alice", is_bot: false } })
  expect(listening.events.some(byText("the gateway itself"))).toBe(false)
  expect(last.author.is_bot).toBe(true)
  expect(last.gateway_marker).toBe(true)
})

test("a human edit arrives as kind edit; an unfurl-only message_changed does not", async () => {
  const listening = startListening(adapterFor(server))
  await listening.ready
  const original = server.humanPost({ channel: FAKE_CHAT, text: "first draft" })
  await listening.waitFor(byText("first draft"), "the original")
  server.sendRaw(JSON.stringify({ type: "message", subtype: "message_changed", channel: FAKE_CHAT, message: { ts: original.ts, user: "U000ALICE", text: "first draft" } }))
  server.humanEdit(FAKE_CHAT, original.ts, "second draft")
  const edit = await listening.waitFor((event) => event.kind === "edit", "the edit")
  await listening.stop()
  expect(edit).toMatchObject({ text: "second draft", edited: { object_id: original.ts, field: "text" } })
  expect(listening.events.filter((event) => event.kind === "edit")).toHaveLength(1)
})

test("a reaction on a thread reply names the gateway reaction and carries the thread", async () => {
  const listening = startListening(adapterFor(server))
  await listening.ready
  const root = server.humanPost({ channel: FAKE_CHAT, text: "root" })
  const reply = server.humanPost({ channel: FAKE_CHAT, text: "reply", thread_ts: root.ts })
  await listening.waitFor(byText("reply"), "the reply")
  server.humanReact(FAKE_CHAT, reply.ts, "white_check_mark")
  const reaction = await listening.waitFor((event) => event.kind === "reaction", "the reaction")
  await listening.stop()
  expect(reaction).toMatchObject({ reaction: { name: "done", on_message_id: reply.ts }, key: { thread_id: root.ts }, edited: null })
})

test("malformed frames are dropped with a log line and the next valid message still arrives", async () => {
  const logs: string[] = []
  const listening = startListening(adapterFor(server, "user", {}, logs))
  await listening.ready
  for (const raw of ["not json", "[1,2]", '{"type":"message"}', '{"type":"message","channel":"C000TEST","ts":"soon"}', '{"type":"reaction_added","item":{}}', '{"no":"type"}']) {
    server.sendRaw(raw)
  }
  server.humanPost({ channel: FAKE_CHAT, text: "still alive" })
  await listening.waitFor(byText("still alive"), "the valid post")
  await listening.stop()
  expect(listening.events.map((event) => event.text)).toEqual(["still alive"])
  expect(logs.filter((line) => line.includes("dropped"))).toHaveLength(4)
})

test("a voice clip is downloaded with the credential and transcribed; without a transcript the fallback text is used", async () => {
  const heard: number[] = []
  const clip = { id: "F000VOICE", name: "audio_message.webm", title: "voice", mimetype: "audio/webm", bytes: new Uint8Array([1, 2, 3, 4]), subtype: "slack_audio" }
  const transcriber = async (bytes: Uint8Array) => {
    heard.push(bytes.byteLength)
    return heard.length === 1 ? { text: "hello from voice" } : { unavailable: "provider down" }
  }
  const listening = startListening(adapterFor(server, "user", { transcriber }))
  await listening.ready
  server.humanPost({ channel: FAKE_DM, text: "", files: [clip] })
  const voiced = await listening.waitFor((event) => event.transcript !== null, "the transcribed clip")
  server.humanPost({ channel: FAKE_DM, text: "", files: [{ ...clip, id: "F000VOICE2" }] })
  const silent = await listening.waitFor(byText(NO_TRANSCRIPT), "the untranscribed clip")
  await listening.stop()
  expect(heard).toEqual([4, 4])
  expect(voiced).toMatchObject({ text: "hello from voice", transcript: "hello from voice", kind: "dm" })
  expect(silent.transcript).toBeNull()
})

test("catchUp: history since the cursor, mentions via search, bound thread replies without the old root", async () => {
  const old = (Date.now() / 1000 - 100).toFixed(6)
  const root = server.humanPost({ channel: FAKE_CHAT, text: "old root", ts: old })
  const since = new Date(Date.now() - 50_000).toISOString()
  server.humanPost({ channel: FAKE_CHAT, text: "new reply", thread_ts: root.ts })
  server.humanPost({ channel: FAKE_CHAT, text: "new top" })
  server.humanPost({ channel: "C000ELSE", text: `ping <@${FAKE_SELF}>` })
  const events: InboundEvent[] = []
  for await (const event of adapterFor(server).catchUp(since, [{ ...server.chat(), thread_id: root.ts }])) events.push(event)
  expect(events.map((event) => [event.kind, event.text])).toEqual([
    ["channel", "new top"],
    ["mention", `ping <@${FAKE_SELF}>`],
    ["thread_reply", "new reply"],
  ])
})

test("catchUp on the app token profile never calls search.messages and skips an unknown channel", async () => {
  const logs: string[] = []
  server.humanPost({ channel: FAKE_CHAT, text: "visible" })
  const events: InboundEvent[] = []
  const adapter = adapterFor(server, "bot", { chats: ["C000GONE", FAKE_CHAT] }, logs)
  for await (const event of adapter.catchUp(new Date(Date.now() - 60_000).toISOString(), [])) events.push(event)
  expect(events.map((event) => event.text)).toEqual(["visible"])
  expect(server.callsOf("search.messages")).toHaveLength(0)
  expect(logs).toEqual([])
})
