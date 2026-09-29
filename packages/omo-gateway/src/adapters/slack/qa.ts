// Slack adapter QA run (plan todo 6). Prints one JSON report; exits 1 when a check fails.
//
//   bun packages/omo-gateway/src/adapters/slack/qa.ts --fake --scenario happy
//   bun packages/omo-gateway/src/adapters/slack/qa.ts --fake --scenario bare-url
//   bun packages/omo-gateway/src/adapters/slack/qa.ts --live --scenario happy --credentials-dir <0700 agent-messenger store> --team <workspace id> --channel <QA channel id>
//
// happy: post a bold GitHub link through the adapter, read conversations.history back and require a
// rich_text block with a `link` element; record whether the token accepted the gateway marker; then
// delete the message and read history again to prove it is gone.
// bare-url: post a bare URL through the adapter with no link_label gate; history must show the URL
// inside a text element and no link element (the gate from todo 9 is what labels links).
// Live mode posts ONLY to --channel and never prints a credential.
import { parseArgs } from "node:util"
import type { SurfaceKey } from "../../adapter/contract"
import { parseRich } from "../../adapter/rich"
import { resolveCredentials } from "../../connector/credentials"
import { SlackAdapter, type SlackAdapterOptions } from "./adapter"
import { AuthLatch, SlackApi } from "./api"
import { realClock } from "./clock"
import { loadSlackSecrets } from "./connect"
import { GATEWAY_MARKER_EVENT } from "./events"
import { FakeSlackServer } from "./testing/fake-server"
import { FAKE_CHAT, FAKE_COOKIE, FAKE_TEAM, FAKE_USER_TOKEN } from "./testing/fake-state"
import { isJson, type Json } from "./wire"

type Step = { step: string; ok: boolean; detail: unknown }
type Target = { options: SlackAdapterOptions; channel: string; fake: FakeSlackServer | null }

const { values } = parseArgs({
  options: {
    fake: { type: "boolean", default: false },
    live: { type: "boolean", default: false },
    scenario: { type: "string", default: "happy" },
    "credentials-dir": { type: "string" },
    team: { type: "string" },
    channel: { type: "string" },
  },
})

const logs: string[] = []

async function target(): Promise<Target> {
  const common = { token_kind: "user" as const, log: (line: string) => logs.push(line) }
  if (values.live) {
    const dir = values["credentials-dir"]
    const team = values.team
    const channel = values.channel
    if (dir === undefined || team === undefined || channel === undefined) throw new Error("--live needs --credentials-dir, --team and --channel")
    const surface = { platform: "slack" as const, account_id: team, credentials_dir: dir }
    const credentials = await resolveCredentials(surface, { env: {}, home: process.env.HOME ?? "" })
    const { api_base, ...secrets } = await loadSlackSecrets({ scope: "qa", surface, credentials, agentDir: "", log: (line) => logs.push(line) })
    const endpoint = api_base === undefined ? {} : { apiBase: api_base }
    return { options: { ...common, account_id: team, ...secrets, ...endpoint, chats: [channel] }, channel, fake: null }
  }
  const fake = new FakeSlackServer()
  return { options: { ...common, account_id: FAKE_TEAM, token: FAKE_USER_TOKEN, cookie: FAKE_COOKIE, apiBase: fake.apiBase, chats: [FAKE_CHAT] }, channel: FAKE_CHAT, fake }
}

function sectionElements(message: Json): Json[] {
  const blocks = Array.isArray(message.blocks) ? message.blocks : []
  const rich = blocks.find((block) => isJson(block) && block.type === "rich_text")
  const section = isJson(rich) && Array.isArray(rich.elements) ? rich.elements.find((element) => isJson(element) && element.type === "rich_text_section") : null
  return isJson(section) && Array.isArray(section.elements) ? section.elements.filter(isJson) : []
}

async function historyMessage(api: SlackApi, channel: string, ts: string): Promise<Json | null> {
  const reply = await api.call("conversations.history", { channel, latest: ts, oldest: ts, inclusive: "true", limit: 1, include_all_metadata: "true" })
  const found = Array.isArray(reply.messages) ? reply.messages.find((message) => isJson(message) && message.ts === ts) : undefined
  return isJson(found) ? found : null
}

async function run(t: Target): Promise<{ steps: Step[]; cleanup: Step[] }> {
  const steps: Step[] = []
  const cleanup: Step[] = []
  const record = (list: Step[], step: string, ok: boolean, detail: unknown) => list.push({ step, ok, detail })
  const adapter = new SlackAdapter(t.options)
  const reader = new SlackApi({
    token: t.options.token,
    ...(t.options.cookie === undefined ? {} : { cookie: t.options.cookie }),
    latch: new AuthLatch(),
    apiBase: t.options.apiBase ?? "https://slack.com/api",
    fetch,
    clock: realClock,
  })
  const key: SurfaceKey = { platform: "slack", account_id: t.options.account_id, chat_id: t.channel, thread_id: null }
  const url = "https://github.com/code-yeongyu/oh-my-openagent/issues/1"
  const body = values.scenario === "bare-url" ? parseRich(`gateway QA bare link ${url}`) : parseRich(`*gateway QA: see <${url}|oh-my-openagent #1>* (message is deleted right after)`)
  const posted = await adapter.send({ op: "post", key, body })
  record(steps, "adapter post resolved with a message ts", posted.message_id !== "", { message_id: posted.message_id, permalink: posted.permalink })
  const message = await historyMessage(reader, t.channel, posted.message_id)
  record(steps, "conversations.history returns the posted message", message !== null, { ts: posted.message_id })
  const elements = message === null ? [] : sectionElements(message)
  const links = elements.filter((element) => element.type === "link")
  if (values.scenario === "bare-url") {
    record(steps, "history shows no link element for the bare URL", links.length === 0, { elements })
    record(steps, "the URL is carried inside a text element", elements.some((element) => element.type === "text" && String(element.text).includes(url)), null)
  } else {
    record(steps, "history shows a rich_text block with a link element", links.some((element) => element.url === url && element.text === "oh-my-openagent #1"), { elements })
    record(steps, "the link is bold", links.length > 0 && links.every((element) => isJson(element.style) && element.style.bold === true), null)
  }
  const marker = message !== null && isJson(message.metadata) ? message.metadata.event_type : null
  const refusal = logs.find((line) => line.includes("message metadata")) ?? null
  record(steps, "gateway marker outcome recorded", marker === GATEWAY_MARKER_EVENT || refusal !== null, { history_metadata_event_type: marker, adapter_log: refusal })
  await reader.call("chat.delete", { channel: t.channel, ts: posted.message_id }).then(
    () => record(cleanup, "chat.delete of the QA message", true, posted.message_id),
    (error: unknown) => record(cleanup, "chat.delete of the QA message", false, String(error)),
  )
  const gone = (await historyMessage(reader, t.channel, posted.message_id)) === null
  record(cleanup, "history no longer shows the QA message", gone, posted.message_id)
  adapter.close()
  return { steps, cleanup }
}

const t = await target()
try {
  const result = await run(t)
  if (t.fake !== null) {
    t.fake.stop()
    result.cleanup.push({ step: "stop fake Slack server", ok: true, detail: "Bun.serve stopped; no files written" })
  }
  const ok = result.steps.every((step) => step.ok) && result.cleanup.every((step) => step.ok)
  console.log(JSON.stringify({ scenario: values.scenario, mode: t.fake === null ? "live" : "fake", ok, at: new Date().toISOString(), ...result, logs }, null, 2))
  process.exit(ok ? 0 : 1)
} catch (error) {
  t.fake?.stop()
  console.error(`slack QA failed: ${error instanceof Error ? error.message : String(error)}`)
  process.exit(1)
}
