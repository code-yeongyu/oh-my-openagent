import { afterEach, describe, expect, test } from "bun:test"
import { mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { AdapterRefusal, type SurfaceKey } from "../../adapter/contract"
import { parseRich } from "../../adapter/rich"
import { FakeDiscordServer, FAKE_TOKEN } from "./testing/fake-server"
import { FAKE_ALICE, FAKE_CHAT, FAKE_DM } from "./testing/fake-state"
import { adapterFor, fastClock, ManualClock } from "./testing/harness"

const servers: FakeDiscordServer[] = []
const dirs: string[] = []
afterEach(() => {
  for (const server of servers.splice(0)) server.stop()
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

function fake(): FakeDiscordServer {
  const server = new FakeDiscordServer()
  servers.push(server)
  return server
}

const text = (value: string) => parseRich(value)

describe("discord adapter outbound ops", () => {
  test("open thread, post, edit, react, archive, reopen: the platform shows each result", async () => {
    const server = fake()
    const adapter = adapterFor(server)
    const opened = await adapter.send({ op: "open_thread", key: server.chat, root: text("*Work item:* ship the fix") })
    const thread: SurfaceKey | null = opened.created
    if (thread === null || thread.thread_id === null) throw new Error("open_thread returned no thread key")
    expect(thread.chat_id).toBe(FAKE_CHAT)
    expect(server.state.channels.get(thread.thread_id)).toMatchObject({ parent_id: FAKE_CHAT, name: "Work item: ship the fix" })
    expect(opened.permalink).toBe(`https://discord.com/channels/300000000000000001/${FAKE_CHAT}/${opened.message_id}`)
    const posted = await adapter.send({ op: "post", key: thread, body: text("progress 1") })
    expect(server.state.messages.get(posted.message_id)?.channel_id).toBe(thread.thread_id)
    await adapter.send({ op: "edit", key: thread, message_id: posted.message_id, body: text("progress 2") })
    expect(server.state.messages.get(posted.message_id)?.content).toBe("progress 2")
    await adapter.send({ op: "react", key: thread, message_id: posted.message_id, name: "done" })
    expect([...(server.state.messages.get(posted.message_id)?.reactions.keys() ?? [])]).toEqual(["\u{2705}"])
    await adapter.send({ op: "typing", key: thread })
    await adapter.send({ op: "archive_thread", key: thread })
    const archived = await fetch(`${server.apiBase}/channels/${thread.thread_id}`, { headers: { Authorization: `Bot ${FAKE_TOKEN}` } })
    expect(await archived.json()).toMatchObject({ thread_metadata: { archived: true } })
    await adapter.send({ op: "reopen_thread", key: thread })
    expect(server.state.channels.get(thread.thread_id)?.archived).toBe(false)
  })

  test("every REST call carries Authorization: Bot <token> and nothing else", async () => {
    const server = fake()
    await adapterFor(server).send({ op: "post", key: server.chat, body: text("hi") })
    expect(server.rest.requests.length).toBeGreaterThan(0)
    expect(new Set(server.rest.requests.map((request) => request.authorization))).toEqual(new Set([`Bot ${FAKE_TOKEN}`]))
  })

  test("bodies render as Discord markdown; only mentioned users may be pinged", async () => {
    const server = fake()
    const posted = await adapterFor(server).send({ op: "post", key: server.chat, body: text(`*see <https://x.test/a|the PR>* for <@${FAKE_ALICE.id}|Alice> in <#${FAKE_CHAT}> (a_b)`) })
    expect(server.state.messages.get(posted.message_id)?.content).toBe(`**see [the PR](<https://x.test/a>)** for <@${FAKE_ALICE.id}> in <#${FAKE_CHAT}> \\(a\\_b\\)`)
    expect(server.state.messages.get(posted.message_id)?.mentions).toEqual([FAKE_ALICE.id])
  })

  test("a body whose Discord rendering exceeds 2000 characters is refused as max_text, not sent", async () => {
    const server = fake()
    const body = [{ t: "link" as const, url: `https://x.test/${"y".repeat(1990)}`, label: "short" }]
    const refused = await adapterFor(server).send({ op: "post", key: server.chat, body }).catch((error: unknown) => error)
    expect(refused).toBeInstanceOf(AdapterRefusal)
    expect(refused instanceof AdapterRefusal ? refused.capability : null).toBe("max_text")
    expect(server.state.inChannel(FAKE_CHAT)).toHaveLength(0)
  })

  test("archive on a chat key and open_thread inside a thread are refused honestly", async () => {
    const server = fake()
    const adapter = adapterFor(server)
    expect(await adapter.send({ op: "archive_thread", key: server.chat }).catch((error: unknown) => error)).toBeInstanceOf(AdapterRefusal)
    const nested = await adapter.send({ op: "open_thread", key: { ...server.chat, thread_id: "1" }, root: text("x") }).catch((error: unknown) => error)
    expect(nested).toBeInstanceOf(AdapterRefusal)
  })

  test("create_chat needs a guild: without guild_id it is false and refused", async () => {
    const server = fake()
    const withGuild = await adapterFor(server).send({ op: "create_chat", key: { platform: "discord", account_id: "x" }, name: "work-requests", kind: "channel", members: [FAKE_ALICE.id] })
    expect(withGuild.created?.chat_id).toEqual(expect.any(String))
    const adapter = adapterFor(server, { guild_id: undefined })
    expect(adapter.capabilities().chat_create).toBe(false)
    const refused = await adapter.send({ op: "create_chat", key: { platform: "discord", account_id: "x" }, name: "n", kind: "channel" }).catch((error: unknown) => error)
    expect(refused).toBeInstanceOf(AdapterRefusal)
  })

  test("an upload of 12 files becomes two messages (10 + 2) in order, the comment on the first", async () => {
    const server = fake()
    const dir = mkdtempSync(join(tmpdir(), "omo-gateway-discord-upload-"))
    dirs.push(dir)
    const files = Array.from({ length: 12 }, (_, index) => {
      const path = join(dir, `f${index}.txt`)
      writeFileSync(path, `file ${index}`)
      return { path, title: `f${index}.txt` }
    })
    const sent = await adapterFor(server).send({ op: "upload", key: server.chat, files, comment: text("the logs") })
    const messages = server.state.inChannel(FAKE_CHAT)
    expect(messages.map((message) => message.attachments.length)).toEqual([10, 2])
    expect(messages.flatMap((message) => message.attachments.map((attachment) => attachment.filename))).toEqual(files.map((file) => file.title))
    expect(messages.map((message) => message.content)).toEqual(["the logs", ""])
    expect(sent.message_id).toBe(messages[0]?.id ?? "")
    expect(new TextDecoder().decode(messages[1]?.attachments[1]?.bytes)).toBe("file 11")
  })
})

describe("discord adapter rate limits", () => {
  test("the sixth message write to one channel within 5 s waits for the window; other channels do not", async () => {
    const server = fake()
    const clock = new ManualClock()
    const adapter = adapterFor(server, { clock })
    for (let index = 0; index < 5; index += 1) await adapter.send({ op: "post", key: server.chat, body: text(`m${index}`) })
    expect(clock.slept).toEqual([])
    await adapter.send({ op: "post", key: { ...server.chat, chat_id: FAKE_DM }, body: text("dm") })
    expect(clock.slept).toEqual([])
    await adapter.send({ op: "post", key: server.chat, body: text("m5") })
    expect(clock.slept).toEqual([5000])
  })

  test("concurrent writes to one channel share one bucket: of 7 at once only the sixth waits", async () => {
    const server = fake()
    const clock = new ManualClock()
    const adapter = adapterFor(server, { clock })
    await Promise.all(Array.from({ length: 7 }, (_, index) => adapter.send({ op: "post", key: server.chat, body: text(`c${index}`) })))
    expect(clock.slept).toEqual([5000])
    expect(server.state.inChannel(FAKE_CHAT)).toHaveLength(7)
  })

  test("a 429 waits retry_after and retries; a persistent 429 fails loudly", async () => {
    const server = fake()
    const clock = fastClock()
    const adapter = adapterFor(server, { clock })
    server.rest.rateLimitNext(2, 1.5)
    await adapter.send({ op: "post", key: server.chat, body: text("after 429") })
    expect(clock.slept).toEqual([1500, 1500])
    expect(server.state.inChannel(FAKE_CHAT).map((message) => message.content)).toEqual(["after 429"])
    server.rest.rateLimitNext(5, 0.1)
    const failed = await adapter.send({ op: "typing", key: server.chat }).catch((error: unknown) => error)
    expect(failed instanceof Error ? failed.message : "").toContain("429")
  })
})
