#!/usr/bin/env bun
// QA driver for the Telegram adapter (gateway plan todo 8) until `omo gateway connect` wires it.
//
//   bun packages/omo-gateway/scripts/telegram-qa.ts --fake --scenario happy
//   bun packages/omo-gateway/scripts/telegram-qa.ts --fake --scenario rate-limit
//   OMO_GATEWAY_TELEGRAM_TOKEN=... bun packages/omo-gateway/scripts/telegram-qa.ts --scenario happy --chat <forum chat id>
//
// happy: create a topic, stream a draft, finalize it, react, close the topic.
// rate-limit (fake only): the Bot API answers 429 retry_after 3; the post must wait >= 3 s on the
// real clock and land exactly once. Prints one JSON report; exits 1 when a check fails.

import { mkdtemp, rm, stat } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { parseArgs } from "node:util"
import type { SurfaceKey } from "../src/adapter/contract"
import { parseRich } from "../src/adapter/rich"
import { TelegramAdapter } from "../src/adapters/telegram/adapter"
import { startFakeTelegramServer, type FakeTelegramServer } from "../src/adapters/telegram/fake-server"
import { FAKE_FORUM } from "../src/adapters/telegram/fake-telegram"

const { values } = parseArgs({
  options: {
    fake: { type: "boolean", default: false },
    scenario: { type: "string", default: "happy" },
    chat: { type: "string" },
  },
})

type Check = { name: string; ok: boolean; detail: string }
const checks: Check[] = []
const check = (name: string, ok: boolean, detail: string) => checks.push({ name, ok, detail })

const dir = await mkdtemp(join(tmpdir(), "omo-gateway-telegram-qa-"))
let server: FakeTelegramServer | null = null
const notices: string[] = []
const token = values.fake ? undefined : process.env.OMO_GATEWAY_TELEGRAM_TOKEN
if (!values.fake && (token === undefined || token === "" || values.chat === undefined)) {
  console.error("live mode needs OMO_GATEWAY_TELEGRAM_TOKEN and --chat <forum chat id>")
  process.exit(2)
}
if (values.fake) server = startFakeTelegramServer()
const adapter = new TelegramAdapter({
  token: server?.token ?? token ?? "",
  ...(server === null ? {} : { apiBase: server.url }),
  statePath: join(dir, "state.json"),
  notice: (text) => notices.push(text),
  log: () => undefined,
})
const chat: SurfaceKey = { platform: "telegram", account_id: adapter.account_id, chat_id: server === null ? (values.chat ?? "") : String(FAKE_FORUM.id), thread_id: null }

async function happy(): Promise<void> {
  const opened = await adapter.send({ op: "open_thread", key: chat, root: parseRich("*Gateway QA* topic") })
  const topic = opened.created
  check("create topic", topic !== null && topic.thread_id !== null, `thread_id ${topic?.thread_id ?? "none"}, root ${opened.message_id}`)
  if (topic === null) return
  const steps = ["Checking", "Checking the adapter", "Checking the adapter: drafts stream"]
  for (const text of steps) await adapter.send({ op: "stream_draft", key: topic, draft_id: "1001", text, final: false })
  check("stream draft", true, `${steps.length} stream_draft updates sent`)
  const final = await adapter.send({ op: "stream_draft", key: topic, draft_id: "1001", text: "Done: drafts stream, see the QA note", final: true })
  check("finalize", final.message_id !== "", `final message ${final.message_id}`)
  await adapter.send({ op: "react", key: topic, message_id: final.message_id, name: "done" })
  check("react", true, "done reaction set")
  await adapter.send({ op: "archive_thread", key: topic })
  check("close topic", true, `topic ${topic.thread_id} closed`)
  if (server !== null) {
    const fake = server.fake
    const shown = fake.message(chat.chat_id, Number(final.message_id))
    check("platform shows final text", shown?.text === "Done: drafts stream, see the QA note", `"${shown?.text ?? ""}"`)
    check("platform shows one done reaction", JSON.stringify(shown?.reactions) === JSON.stringify(["\u{1F44D}"]), JSON.stringify(shown?.reactions))
    check("platform saw every draft", fake.drafts.length === steps.length, `${fake.drafts.length} drafts`)
    check("platform topic closed", fake.isTopicClosed(chat.chat_id, topic.thread_id ?? ""), "closeForumTopic applied")
  }
}

async function rateLimit(): Promise<void> {
  if (server === null) throw new Error("rate-limit runs against the fake server only")
  server.failNext("sendMessage", { error_code: 429, description: "Too Many Requests: retry after 3", parameters: { retry_after: 3 } })
  const started = performance.now()
  const sent = await adapter.send({ op: "post", key: chat, body: parseRich("post under a 429") })
  const waited = Math.round(performance.now() - started)
  const landed = server.fake.messages.filter((message) => message.text === "post under a 429").length
  check("waited for retry_after", waited >= 3000, `${waited} ms on the real clock`)
  check("succeeded after the wait", sent.message_id !== "", `message ${sent.message_id}`)
  check("no duplicate post", landed === 1, `${landed} copies on the platform`)
}

let failure: string | null = null
try {
  if (values.scenario === "happy") await happy()
  else if (values.scenario === "rate-limit") await rateLimit()
  else throw new Error(`unknown scenario ${values.scenario}`)
} catch (error) {
  failure = error instanceof Error ? `${error.name}: ${error.message}` : String(error)
}

const cleanup: string[] = []
if (server !== null) {
  const url = server.url
  await server.stop()
  const closed = await fetch(`${url}/bot${server.token}/getMe`).then(
    () => false,
    () => true,
  )
  cleanup.push(`fake server ${closed ? "stopped (port refuses connections)" : "STILL ANSWERING"}`)
}
await rm(dir, { recursive: true, force: true })
const removed = await stat(dir).then(
  () => false,
  () => true,
)
cleanup.push(`temp dir ${removed ? "removed" : "STILL PRESENT"}`)

const ok = failure === null && checks.every((entry) => entry.ok) && notices.length === 0
console.log(JSON.stringify({ scenario: values.scenario, mode: server === null ? "live" : "fake", ok, failure, checks, notices, cleanup }, null, 2))
process.exit(ok ? 0 : 1)
