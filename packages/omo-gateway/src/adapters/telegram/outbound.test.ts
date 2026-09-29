import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { AdapterRefusal, type SurfaceKey } from "../../adapter/contract"
import { parseRich } from "../../adapter/rich"
import { FAKE_BOT, FAKE_DM, FAKE_FORUM, FAKE_HUMAN } from "./fake-telegram"
import { listenFor, telegramHarness, type TelegramHarness } from "./harness"

let h: TelegramHarness
const forum: SurfaceKey = { platform: "telegram", account_id: String(FAKE_BOT.id), chat_id: String(FAKE_FORUM.id), thread_id: null }
const dm: SurfaceKey = { ...forum, chat_id: String(FAKE_DM.id) }
const sendsTo = (method: string) => h.server.fake.calls.filter((call) => call.method === method).length

beforeEach(async () => {
  h = await telegramHarness()
})

afterEach(async () => {
  await h.close()
})

describe("429 retry_after", () => {
  test("a 429 with retry_after 3 waits at least 3 s, then succeeds with exactly one post", async () => {
    h.server.failNext("sendMessage", { error_code: 429, description: "Too Many Requests: retry after 3", parameters: { retry_after: 3 } })
    const adapter = h.make()
    const before = h.clock.elapsed()
    const sent = await adapter.send({ op: "post", key: dm, body: parseRich("rate limited hello") })
    expect(h.clock.sleeps).toContain(3000)
    expect(h.clock.elapsed() - before).toBeGreaterThanOrEqual(3000)
    expect(h.server.fake.messages.filter((message) => message.text === "rate limited hello")).toHaveLength(1)
    expect(sent.message_id).not.toBe("")
  })

  test("a 400 is not retried and surfaces with the token redacted", async () => {
    const adapter = h.make()
    const failed = adapter.send({ op: "edit", key: dm, message_id: "999", body: parseRich("nothing to edit") })
    await expect(failed).rejects.toThrow("message to edit not found")
    await failed.catch((error: unknown) => expect(String(error)).not.toContain(h.server.token))
    expect(sendsTo("editMessageText")).toBe(1)
  })
})

describe("token buckets", () => {
  test("posts to one chat are spaced at least 1 s apart", async () => {
    const adapter = h.make()
    const start = h.clock.now()
    await Promise.all([1, 2, 3].map((n) => adapter.send({ op: "post", key: dm, body: parseRich(`burst ${n}`) })))
    expect(h.clock.now() - start).toBeGreaterThanOrEqual(2000)
    expect(h.server.fake.messages.filter((message) => message.chat_id === dm.chat_id).map((message) => message.text)).toEqual(["burst 1", "burst 2", "burst 3"])
  })

  test("a group accepts 20 posts in a minute; the 21st waits for the window", async () => {
    const adapter = h.make({ limits: { perChatIntervalMs: 0 } })
    const start = h.clock.now()
    for (let n = 1; n <= 20; n += 1) await adapter.send({ op: "post", key: forum, body: parseRich(`group ${n}`) })
    expect(h.clock.now() - start).toBe(0)
    await adapter.send({ op: "post", key: forum, body: parseRich("group 21") })
    expect(h.clock.now() - start).toBeGreaterThanOrEqual(60_000)
  })
})

describe("rendering and ops", () => {
  test("bold links, mentions and markup-looking text reach Telegram as parsed HTML", async () => {
    const adapter = h.make()
    const sent = await adapter.send({ op: "post", key: dm, body: parseRich("*see <https://x.test/a?b=1&c=2|X & Y>* for <@1000000001|Alice> a<b") })
    expect(h.server.fake.message(dm.chat_id, Number(sent.message_id))?.text).toBe("see X & Y for @Alice a<b")
  })

  test("editing to identical text is accepted as a no-op", async () => {
    const adapter = h.make()
    const sent = await adapter.send({ op: "post", key: dm, body: parseRich("same") })
    await expect(adapter.send({ op: "edit", key: dm, message_id: sent.message_id, body: parseRich("same") })).resolves.toMatchObject({ message_id: sent.message_id })
  })

  test("open_thread creates a forum topic; archive and reopen close and reopen it", async () => {
    const adapter = h.make()
    const opened = await adapter.send({ op: "open_thread", key: forum, root: parseRich("QA topic") })
    const thread = opened.created
    expect(thread?.thread_id).not.toBeNull()
    if (thread === null || thread.thread_id === null) throw new Error("no topic")
    await adapter.send({ op: "archive_thread", key: thread })
    expect(h.server.fake.isTopicClosed(thread.chat_id, thread.thread_id)).toBe(true)
    await adapter.send({ op: "archive_thread", key: thread })
    await adapter.send({ op: "reopen_thread", key: thread })
    expect(h.server.fake.isTopicClosed(thread.chat_id, thread.thread_id)).toBe(false)
  })

  test("stream_draft sends ordered drafts that post nothing, and final: true posts the one final message", async () => {
    const adapter = h.make()
    const messagesBefore = h.server.fake.messages.length
    const drafts = ["thinking", "thinking <harder> & longer"]
    for (const text of drafts) {
      expect(await adapter.send({ op: "stream_draft", key: dm, draft_id: "42", text, final: false })).toMatchObject({ message_id: "" })
    }
    expect(h.server.fake.messages.length).toBe(messagesBefore)
    const final = await adapter.send({ op: "stream_draft", key: dm, draft_id: "42", text: "final answer", final: true })
    expect(h.server.fake.drafts).toEqual(drafts.map((text) => ({ chat_id: dm.chat_id, draft_id: 42, text })))
    expect(h.server.fake.messages.slice(messagesBefore).map((message) => message.text)).toEqual(["final answer"])
    expect(h.server.fake.message(dm.chat_id, Number(final.message_id))?.text).toBe("final answer")
    const tooLong = adapter.send({ op: "stream_draft", key: dm, draft_id: "42", text: "x".repeat(4097), final: false })
    await expect(tooLong).rejects.toMatchObject({ name: "AdapterRefusal", capability: "max_text" })
  })

  test("numbered options: number reactions are refused, the numbered lines reach Telegram, and a numbered reply arrives as reply text", async () => {
    const adapter = h.make()
    const question = await adapter.send({ op: "post", key: dm, body: parseRich("Which one?\n1. Ship now\n2. Wait for review") })
    expect(h.server.fake.message(dm.chat_id, Number(question.message_id))?.text).toBe("Which one?\n1. Ship now\n2. Wait for review")
    await expect(adapter.send({ op: "react", key: dm, message_id: question.message_id, name: "number_2" })).rejects.toMatchObject({
      name: "AdapterRefusal",
      capability: "reactions",
    })
    const [answer] = await listenFor(adapter, 1, () => {
      h.server.fake.rawUpdate({
        message: {
          message_id: 900,
          chat: FAKE_DM,
          from: FAKE_HUMAN,
          date: Math.floor(Date.now() / 1000),
          text: "2",
          reply_to_message: { message_id: Number(question.message_id), from: FAKE_BOT, chat: FAKE_DM, date: 0, text: "Which one?\n1. Ship now\n2. Wait for review" },
        },
      })
    })
    expect(answer).toMatchObject({ kind: "dm", text: "2", reply_to: { message_id: question.message_id } })
  })

  test("reactions without a Telegram emoji are refused; create_chat is refused", async () => {
    const adapter = h.make()
    const sent = await adapter.send({ op: "post", key: dm, body: parseRich("vote") })
    await expect(adapter.send({ op: "react", key: dm, message_id: sent.message_id, name: "number_1" })).rejects.toBeInstanceOf(AdapterRefusal)
    await expect(adapter.send({ op: "create_chat", key: { platform: "telegram", account_id: forum.account_id }, name: "x", kind: "topic" })).rejects.toBeInstanceOf(AdapterRefusal)
  })

  test("typing sends a chat action, and uploads send photos and documents in order", async () => {
    const adapter = h.make()
    await adapter.send({ op: "typing", key: dm })
    expect(sendsTo("sendChatAction")).toBe(1)
    await adapter.send({ op: "upload", key: dm, files: h.files, comment: parseRich("three files") })
    expect(h.server.fake.calls.filter((call) => call.method === "sendPhoto" || call.method === "sendDocument").map((call) => call.method)).toEqual(["sendDocument", "sendPhoto", "sendDocument"])
  })
})
