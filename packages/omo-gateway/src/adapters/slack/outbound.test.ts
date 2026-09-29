import { afterEach, beforeEach, expect, test } from "bun:test"
import { mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { AdapterFatal, AdapterRefusal } from "../../adapter/contract"
import { parseRich } from "../../adapter/rich"
import { SlackApiError, SlackAuthError } from "./api"
import { GATEWAY_MARKER_EVENT } from "./events"
import { FakeSlackServer } from "./testing/fake-server"
import { FAKE_ALICE, FAKE_CHAT, FAKE_TEAM } from "./testing/fake-state"
import { SHARE_LOOKUP } from "./upload"
import { adapterFor, ManualClock } from "./testing/harness"

let server: FakeSlackServer

beforeEach(() => {
  server = new FakeSlackServer()
})

afterEach(() => {
  server.stop()
})

const sectionOf = (ts: string): unknown[] => {
  const blocks = server.state.find(FAKE_CHAT, ts)?.blocks ?? []
  const first: unknown = blocks[0]
  const section: unknown = first !== null && typeof first === "object" && "elements" in first && Array.isArray(first.elements) ? first.elements[0] : null
  return section !== null && typeof section === "object" && "elements" in section && Array.isArray(section.elements) ? section.elements : []
}

test("a post carries explicit rich_text elements: a bold link, a mention, a channel; text is the label-only fallback", async () => {
  const posted = await adapterFor(server).send({
    op: "post",
    key: server.chat(),
    body: parseRich(`*see <https://github.com/example/repo/pull/7|example/repo #7 Fix the thing>* <@${FAKE_ALICE}> in <#${FAKE_CHAT}>`),
  })
  expect(sectionOf(posted.message_id)).toEqual([
    { type: "text", text: "see ", style: { bold: true } },
    { type: "link", url: "https://github.com/example/repo/pull/7", text: "example/repo #7 Fix the thing", style: { bold: true } },
    { type: "text", text: " " },
    { type: "user", user_id: FAKE_ALICE },
    { type: "text", text: " in " },
    { type: "channel", channel_id: FAKE_CHAT },
  ])
  expect(server.state.find(FAKE_CHAT, posted.message_id)?.text).toBe(`see example/repo #7 Fix the thing <@${FAKE_ALICE}> in <#${FAKE_CHAT}>`)
  expect(posted.permalink).toBe(`https://fake-workspace.invalid/archives/${FAKE_CHAT}/p${posted.message_id.replace(".", "")}`)
})

test("a bare URL posted without the link_label gate is sent as plain text, never as a link element", async () => {
  const url = "https://github.com/example/repo/pull/7"
  const posted = await adapterFor(server).send({ op: "post", key: server.chat(), body: parseRich(`done, see ${url}`) })
  expect(sectionOf(posted.message_id)).toEqual([{ type: "text", text: `done, see ${url}` }])
})

test("posts to one channel are paced at one per second on the clock; another channel is not held back", async () => {
  const clock = new ManualClock()
  const adapter = adapterFor(server, "user", { clock })
  const started = clock.now()
  const at: number[] = []
  for (let index = 0; index < 3; index += 1) {
    await adapter.send({ op: "post", key: server.chat(), body: parseRich(`paced ${index}`) })
    at.push(clock.now() - started)
  }
  const before = clock.now()
  await adapter.send({ op: "post", key: { ...server.chat(), chat_id: "D000ALICE" }, body: parseRich("elsewhere") })
  expect(at).toEqual([0, 1000, 2000])
  expect(clock.now()).toBe(before)
})

test("send reports success only after ok: true; an ok:false post or reaction rejects, and a 429 is waited out and lands once", async () => {
  const adapter = adapterFor(server)
  server.failNext("chat.postMessage", { error: "not_in_channel" })
  const refused = await adapter.send({ op: "post", key: server.chat(), body: parseRich("first") }).catch((error: unknown) => error)
  expect(refused).toBeInstanceOf(SlackApiError)
  expect(server.at(server.chat())).toHaveLength(0)
  server.failNext("reactions.add", { error: "message_not_found" })
  const unreacted = await adapter.send({ op: "react", key: server.chat(), message_id: "1700000000.000100", name: "done" }).catch((error: unknown) => error)
  expect(unreacted instanceof SlackApiError ? unreacted.error : unreacted).toBe("message_not_found")
  server.failNext("chat.postMessage", { status: 429, retryAfter: 2 })
  await adapter.send({ op: "post", key: server.chat(), body: parseRich("second") })
  expect(server.at(server.chat()).map((message) => message.text)).toEqual(["second"])
})

test("a user token that silently drops metadata loses the marker after the first post; an app token keeps it", async () => {
  const logs: string[] = []
  const user = adapterFor(server, "user", {}, logs)
  await user.send({ op: "post", key: server.chat(), body: parseRich("one") })
  await user.send({ op: "post", key: server.chat(), body: parseRich("two") })
  expect(server.at(server.chat()).map((message) => message.text)).toEqual(["one", "two"])
  expect(server.callsOf("chat.postMessage").map((call) => "metadata" in call.params)).toEqual([true, false])
  expect(logs.filter((line) => line.includes("did not store message metadata"))).toHaveLength(1)
  const bot = adapterFor(server, "bot")
  for (const text of ["three", "four"]) {
    const sent = await bot.send({ op: "post", key: server.chat(), body: parseRich(text) })
    expect(server.state.find(FAKE_CHAT, sent.message_id)?.metadata?.event_type).toBe(GATEWAY_MARKER_EVENT)
  }
})

test("a token that refuses metadata outright gets the post retried once without it, and the marker stays off", async () => {
  const logs: string[] = []
  const adapter = adapterFor(server, "bot", {}, logs)
  server.failNext("chat.postMessage", { error: "metadata_must_be_sent_from_app" })
  await adapter.send({ op: "post", key: server.chat(), body: parseRich("retried") })
  await adapter.send({ op: "post", key: server.chat(), body: parseRich("plain") })
  expect(server.at(server.chat()).map((message) => [message.text, message.metadata])).toEqual([
    ["retried", null],
    ["plain", null],
  ])
  expect(server.callsOf("chat.postMessage").map((call) => "metadata" in call.params)).toEqual([true, false, false])
  expect(logs.filter((line) => line.includes("refused message metadata"))).toHaveLength(1)
})

test("reactions are idempotent and map gateway names to Slack names", async () => {
  const adapter = adapterFor(server)
  const posted = await adapter.send({ op: "post", key: server.chat(), body: parseRich("react") })
  const react = (op: "react" | "unreact", name: string) => adapter.send({ op, key: server.chat(), message_id: posted.message_id, name })
  await react("react", "working")
  await react("react", "working")
  await react("unreact", "question")
  await react("react", "\u{2705}")
  expect([...(server.state.find(FAKE_CHAT, posted.message_id)?.reactions.keys() ?? [])]).toEqual(["hourglass_flowing_sand", "white_check_mark"])
})

test("an upload stages every file and completes them in one call, in order, returning the shared message ts", async () => {
  const dir = mkdtempSync(join(tmpdir(), "omo-gateway-slack-upload-"))
  try {
    const files = ["a.txt", "b.txt"].map((title) => {
      writeFileSync(join(dir, title), title)
      return { path: join(dir, title), title }
    })
    const sent = await adapterFor(server).send({ op: "upload", key: server.chat(), files, comment: parseRich("*two* files") })
    expect(server.callsOf("files.getUploadURLExternal")).toHaveLength(2)
    expect(server.callsOf("files.completeUploadExternal")).toHaveLength(1)
    const message = server.state.find(FAKE_CHAT, sent.message_id)
    expect(message?.files.map((file) => file.title)).toEqual(["a.txt", "b.txt"])
    expect(message === undefined ? "" : server.state.plain(message)).toBe("two files")
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test("app token: typing uses the assistant status inside a thread and is refused at top level", async () => {
  const adapter = adapterFor(server, "bot")
  const root = await adapter.send({ op: "post", key: server.chat(), body: parseRich("root") })
  const thread = { ...server.chat(), thread_id: root.message_id }
  await adapter.send({ op: "typing", key: thread })
  expect(server.counters.statuses).toEqual([{ channel: FAKE_CHAT, thread_ts: root.message_id, status: "is typing..." }])
  expect(await adapter.send({ op: "typing", key: server.chat() }).catch((error: unknown) => error)).toBeInstanceOf(AdapterRefusal)
})

test("app token: stream_draft opens one stream to the asking person, appends only new text, and the final op closes it", async () => {
  const adapter = adapterFor(server, "bot")
  const question = server.humanPost({ channel: FAKE_CHAT, text: "how is the build?" })
  const thread = { ...server.chat(), thread_id: question.ts }
  for (const text of ["Hello", "Hello, wor", "Hello, wor"]) {
    expect((await adapter.send({ op: "stream_draft", key: thread, draft_id: "d1", text, final: false })).message_id).toBe("")
  }
  const final = await adapter.send({ op: "stream_draft", key: thread, draft_id: "d1", text: "Hello, world", final: true })
  expect(server.state.find(FAKE_CHAT, final.message_id)?.text).toBe("Hello, world")
  expect(server.state.drafts.get(final.message_id)).toEqual(["Hello", "Hello, wor"])
  expect(server.callsOf("chat.startStream").map((call) => [call.params.recipient_user_id, call.params.recipient_team_id])).toEqual([[FAKE_ALICE, FAKE_TEAM]])
  expect(server.callsOf("chat.appendStream").map((call) => call.params.markdown_text)).toEqual([", wor"])
  expect(server.callsOf("chat.stopStream").map((call) => call.params.markdown_text)).toEqual(["ld"])
})

test("app token: a final stream_draft that rewrites the drafts replaces the message text", async () => {
  const adapter = adapterFor(server, "bot")
  const question = server.humanPost({ channel: FAKE_CHAT, text: "summary please" })
  const thread = { ...server.chat(), thread_id: question.ts }
  await adapter.send({ op: "stream_draft", key: thread, draft_id: "d2", text: "Working on it", final: false })
  const final = await adapter.send({ op: "stream_draft", key: thread, draft_id: "d2", text: "Done: all green", final: true })
  const message = server.state.find(FAKE_CHAT, final.message_id)
  expect(message === undefined ? null : server.state.plain(message)).toBe("Done: all green")
  expect(server.callsOf("chat.update")).toHaveLength(1)
})

test("stream_draft is refused at the top level on the app token and entirely on the user token", async () => {
  const topLevel = await adapterFor(server, "bot").send({ op: "stream_draft", key: server.chat(), draft_id: "d3", text: "x", final: false }).catch((error: unknown) => error)
  expect(topLevel instanceof AdapterRefusal ? topLevel.capability : topLevel).toBe("draft_stream")
  const question = server.humanPost({ channel: FAKE_CHAT, text: "q" })
  const thread = { ...server.chat(), thread_id: question.ts }
  const user = await adapterFor(server, "user").send({ op: "stream_draft", key: thread, draft_id: "d3", text: "x", final: false }).catch((error: unknown) => error)
  expect(user instanceof AdapterRefusal ? user.capability : user).toBe("draft_stream")
  expect(server.callsOf("chat.startStream")).toEqual([])
})

test("the adapter's public surface carries no Slack-only streaming method: streaming is the stream_draft op", () => {
  expect(Reflect.has(adapterFor(server, "bot"), "stream")).toBe(false)
})

test("create_chat makes a private channel for a group and refuses topics", async () => {
  const adapter = adapterFor(server)
  const made = await adapter.send({ op: "create_chat", key: { platform: "slack", account_id: FAKE_TEAM }, name: "Work Item 12!", kind: "group", members: [FAKE_ALICE] })
  const id = made.created?.chat_id ?? ""
  expect(server.state.channels.get(id)).toMatchObject({ name: "work-item-12", is_private: true })
  expect(server.callsOf("conversations.invite")[0]?.params.users).toBe(FAKE_ALICE)
  expect(await adapter.send({ op: "create_chat", key: { platform: "slack", account_id: FAKE_TEAM }, name: "t", kind: "topic" }).catch((error: unknown) => error)).toBeInstanceOf(AdapterRefusal)
})

test("an invalid_auth answer on a send raises AdapterFatal; later sends refuse the same way without calling Slack", async () => {
  const adapter = adapterFor(server, "user")
  server.failNext("chat.postMessage", { error: "invalid_auth" })
  const first = await adapter.send({ op: "post", key: server.chat(), body: parseRich("x") }).catch((error: unknown) => error)
  expect(first).toBeInstanceOf(SlackAuthError)
  expect(first instanceof AdapterFatal ? [first.platform, first.reason] : null).toEqual(["slack", "invalid_auth"])
  const calls = server.calls.length
  expect(await adapter.send({ op: "post", key: server.chat(), body: parseRich("y") }).catch((error: unknown) => error)).toBe(first)
  expect(server.calls.length).toBe(calls)
})

test("an upload whose share files.info shows late is read again on the clock until the share message appears", async () => {
  const dir = mkdtempSync(join(tmpdir(), "omo-gateway-slack-upload-lag-"))
  try {
    writeFileSync(join(dir, "a.txt"), "a")
    const clock = new ManualClock()
    server.counters.hiddenShares = 2
    const sent = await adapterFor(server, "user", { clock }).send({ op: "upload", key: server.chat(), files: [{ path: join(dir, "a.txt"), title: "a.txt" }], comment: null })
    expect(server.state.find(FAKE_CHAT, sent.message_id)?.files.map((file) => file.title)).toEqual(["a.txt"])
    expect(server.callsOf("files.info")).toHaveLength(3)
    expect(clock.slept.filter((ms) => ms >= SHARE_LOOKUP.firstDelayMs)).toEqual([SHARE_LOOKUP.firstDelayMs, SHARE_LOOKUP.firstDelayMs * 2])
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test("an upload whose share never appears returns the file id as a non-empty message_id after a bounded number of reads", async () => {
  const dir = mkdtempSync(join(tmpdir(), "omo-gateway-slack-upload-fallback-"))
  try {
    writeFileSync(join(dir, "b.txt"), "b")
    const logs: string[] = []
    server.counters.hiddenShares = 1_000
    const sent = await adapterFor(server, "user", { clock: new ManualClock() }, logs).send({ op: "upload", key: server.chat(), files: [{ path: join(dir, "b.txt"), title: "b.txt" }], comment: null })
    const fileId = server.callsOf("files.info")[0]?.params.file ?? ""
    expect(fileId).toStartWith("F")
    expect(sent.message_id).toBe(fileId)
    expect(sent.permalink).toContain(fileId)
    expect(server.callsOf("files.info")).toHaveLength(SHARE_LOOKUP.attempts)
    expect(logs.filter((line) => line.includes("returning the file id as message_id"))).toHaveLength(1)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})
