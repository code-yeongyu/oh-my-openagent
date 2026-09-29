import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { readFile, stat, writeFile } from "node:fs/promises"
import { AdapterFatal, type SurfaceKey } from "../../adapter/contract"
import { NO_TRANSCRIPT } from "../../stt/transcribe"
import { TelegramAuthError, TelegramConflictError } from "./api"
import { FAKE_BOT, FAKE_DM, FAKE_FORUM, FAKE_HUMAN } from "./fake-telegram"
import { bounded, listenFor, listenOutcome, telegramHarness, type TelegramHarness } from "./harness"

let h: TelegramHarness
const forum: SurfaceKey = { platform: "telegram", account_id: String(FAKE_BOT.id), chat_id: String(FAKE_FORUM.id), thread_id: null }
const dm: SurfaceKey = { ...forum, chat_id: String(FAKE_DM.id) }

beforeEach(async () => {
  h = await telegramHarness()
})

afterEach(async () => {
  await h.close()
})

describe("offset persistence", () => {
  test("a restarted adapter resumes from the saved offset and never re-delivers handled updates", async () => {
    const first = await listenFor(h.make(), 3, () => {
      for (const text of ["one", "two", "three"]) h.server.fake.humanPost({ key: forum, text })
    })
    expect(first.map((event) => event.text)).toEqual(["one", "two", "three"])
    const saved: unknown = JSON.parse(await readFile(h.statePath, "utf8"))
    expect(saved).toMatchObject({ offset: 4 })
    expect((await stat(h.statePath)).mode & 0o777).toBe(0o600)

    const offsetsBefore = h.server.pollOffsets.length
    const second = await listenFor(h.make(), 1, () => {
      h.server.fake.humanPost({ key: forum, text: "four" })
    })
    expect(second.map((event) => event.text)).toEqual(["four"])
    expect(h.server.pollOffsets[offsetsBefore]).toBe(4)
  })

  test("catchUp after a restart re-reads the unconfirmed updates under their original event_ids, and drains pending ones", async () => {
    const live = await listenFor(h.make(), 1, () => {
      h.server.fake.humanPost({ key: forum, text: "seen live" })
    })
    h.server.fake.humanPost({ key: forum, text: "arrived while down" })
    const restarted = h.make()
    const replayed = []
    for await (const event of restarted.catchUp(new Date(Date.now() - 60_000).toISOString(), [])) replayed.push(event)
    expect(replayed.map((event) => event.text)).toEqual(["seen live", "arrived while down"])
    expect(replayed[0]?.event_id).toBe(live[0]?.event_id)
    const again = []
    for await (const event of h.make().catchUp(new Date(Date.now() - 60_000).toISOString(), [])) again.push(event.event_id)
    expect(again).toEqual(replayed.map((event) => event.event_id))
  })

  test("the state file after a burst keeps ids and cursors only: no message text, caption, transcript or file name", async () => {
    const texts = ["alpha burst text", "bravo burst text", "charlie burst text"]
    const caption = "delta caption words"
    const fileName = "echo-private-report.pdf"
    const transcript = "foxtrot spoken words"
    const adapter = h.make({ transcribe: async () => ({ text: transcript }) })
    const events = await listenFor(adapter, 5, () => {
      for (const text of texts) h.server.fake.humanPost({ key: forum, text })
      h.server.fake.rawUpdate({
        message: { message_id: 500, chat: FAKE_FORUM, from: FAKE_HUMAN, date: Math.floor(Date.now() / 1000), caption, document: { file_id: "doc-1", file_unique_id: "udoc-1", file_name: fileName, file_size: 10 } },
      })
      h.server.fake.humanPost({ key: dm, text: "", voice: new Uint8Array([7, 7]) })
    })
    expect(events.map((event) => event.text)).toEqual([...texts, caption, transcript])
    for await (const _ of h.make().catchUp(new Date(Date.now() - 60_000).toISOString(), [])) void _
    const raw = await readFile(h.statePath, "utf8")
    for (const secret of [...texts, caption, fileName, transcript]) expect(raw).not.toContain(secret)
    const saved: unknown = JSON.parse(raw)
    expect(Object.keys(saved ?? {}).sort()).toEqual(["confirmed", "offset", "seen"])
    expect(saved).toMatchObject({ seen: events.map((event) => ({ event_id: event.event_id, at: event.at })) })
  })

  test("a corrupt state file is reported; unconfirmed updates replay with their original event_ids, nothing is lost", async () => {
    const [before] = await listenFor(h.make(), 1, () => {
      h.server.fake.humanPost({ key: forum, text: "before corruption" })
    })
    await writeFile(h.statePath, "{not json")
    const events = await listenFor(h.make(), 2, () => {
      h.server.fake.humanPost({ key: forum, text: "after corruption" })
    })
    expect(events.map((event) => event.text)).toEqual(["before corruption", "after corruption"])
    expect(events[0]?.event_id).toBe(before?.event_id)
    expect(h.logs.some((line) => line.includes("state file is not JSON"))).toBe(true)
  })
})

describe("stop conditions", () => {
  test("getUpdates 409 stops the adapter with exactly one notice, and it stays stopped", async () => {
    h.server.failNext("getUpdates", { error_code: 409, description: "Conflict: terminated by other getUpdates request; make sure that only one bot instance is running" })
    const adapter = h.make()
    const first = await listenOutcome(adapter)
    expect(first).toBeInstanceOf(TelegramConflictError)
    expect(first instanceof AdapterFatal ? [first.platform, first.reason] : null).toEqual(["telegram", "409"])
    expect(await listenOutcome(adapter)).toBeInstanceOf(TelegramConflictError)
    const drain = async () => {
      for await (const _ of adapter.catchUp(new Date(0).toISOString(), [])) void _
    }
    await expect(drain()).rejects.toBeInstanceOf(TelegramConflictError)
    expect(h.notices).toHaveLength(1)
    expect(h.notices[0]).toContain("stopped")
    expect(h.notices[0]).not.toContain(h.server.token)
  }, 15_000)

  test("a second poller on the same bot makes the first one stop with one notice", async () => {
    const first = h.make({ pollTimeoutSec: 30 })
    const firstIsHolding = h.server.pollsReached(h.server.pollOffsets.length + 2)
    const firstController = new AbortController()
    const firstOutcome = first.listen(() => undefined, firstController.signal, () => undefined).then(
      () => "resolved without an error",
      (error: unknown) => error,
    )
    await firstIsHolding
    const events = await listenFor(h.make(), 1, () => {
      h.server.fake.humanPost({ key: forum, text: "for the second poller" })
    })
    const outcome = await bounded(firstOutcome, 3_000, () => "the first poller to stop after the 409").catch(async (error: unknown) => {
      firstController.abort()
      await firstOutcome
      return error
    })
    expect(outcome).toBeInstanceOf(TelegramConflictError)
    expect(events.map((event) => event.text)).toEqual(["for the second poller"])
    expect(h.notices).toHaveLength(1)
  }, 15_000)

  test("a rejected token stops the adapter with one notice and no retry loop", async () => {
    const adapter = h.make({ token: `${FAKE_BOT.id}:WRONG-TOKEN` })
    const outcome = await listenOutcome(adapter)
    expect(outcome).toBeInstanceOf(TelegramAuthError)
    expect(outcome instanceof AdapterFatal ? [outcome.platform, outcome.reason] : null).toEqual(["telegram", "401"])
    expect(String(outcome)).not.toContain("WRONG-TOKEN")
    expect(h.notices).toHaveLength(1)
    expect(h.notices.join("\n")).not.toContain("WRONG-TOKEN")
  }, 15_000)
})

describe("malformed input", () => {
  test("malformed updates, a non-array result and a non-JSON answer are skipped without stopping the poller", async () => {
    h.server.failNext("getUpdates", { raw: "<html>bad gateway</html>", status: 502 })
    h.server.failNext("getUpdates", { raw: '{"ok":true,"result":{"not":"an array"}}', status: 200 })
    for (const update of [{ message: { message_id: "nope" } }, { edited_message: 5 }, { message_reaction: {} }, { callback_query: { id: "x" } }, { message: { message_id: 9, chat: FAKE_FORUM, date: 1 } }]) {
      h.server.fake.rawUpdate(update)
    }
    const events = await listenFor(h.make(), 1, () => {
      h.server.fake.humanPost({ key: forum, text: "after the garbage" })
    })
    expect(events.map((event) => event.text)).toEqual(["after the garbage"])
    expect(h.logs.some((line) => line.includes("non-JSON"))).toBe(true)
    expect(h.logs.some((line) => line.includes("non-array"))).toBe(true)
    expect(h.notices).toEqual([])
  })
})

describe("inbound shapes over the wire", () => {
  test("a voice message is transcribed in memory; the event names the file by id, never by a token URL", async () => {
    const audio = new Uint8Array([1, 2, 3, 4])
    const heard: Uint8Array[] = []
    const adapter = h.make({
      transcribe: async (bytes) => {
        heard.push(bytes)
        return { text: "hello from a voice note" }
      },
    })
    const [event] = await listenFor(adapter, 1, () => {
      h.server.fake.humanPost({ key: dm, text: "", voice: audio })
    })
    expect(heard).toEqual([audio])
    expect(event).toMatchObject({ kind: "dm", text: "hello from a voice note", transcript: "hello from a voice note" })
    expect(event?.attachments[0]?.url.startsWith("tg-file:")).toBe(true)
    expect(JSON.stringify(event)).not.toContain(h.server.token)
  })

  test("a voice message without a transcriber gets the no-transcript text", async () => {
    const [event] = await listenFor(h.make(), 1, () => {
      h.server.fake.humanPost({ key: dm, text: "", voice: new Uint8Array([9]) })
    })
    expect(event).toMatchObject({ text: NO_TRANSCRIPT, transcript: null })
  })

  test("reactions arrive as kind reaction under gateway names; topic replies carry the topic as thread_id", async () => {
    const adapter = h.make()
    const posted = await adapter.send({ op: "post", key: forum, body: [{ t: "text", text: "react to me" }] })
    const events = await listenFor(adapter, 2, () => {
      h.server.fake.humanReact(forum.chat_id, Number(posted.message_id), "\u{1F44D}")
      h.server.fake.humanPost({ key: { ...forum, thread_id: "77" }, text: "in a topic" })
    })
    expect(events[0]).toMatchObject({ kind: "reaction", reaction: { name: "done", on_message_id: posted.message_id } })
    expect(events[1]).toMatchObject({ kind: "thread_reply", key: { thread_id: "77" } })
  })
})
