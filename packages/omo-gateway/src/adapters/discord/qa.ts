// Discord adapter QA run (plan todo 7 happy scenario): open a thread, post, edit, react, archive,
// then read the thread back and require `archived: true`; finally clean up what it created.
//
//   bun packages/omo-gateway/src/adapters/discord/qa.ts --fake
//   OMO_GATEWAY_QA_DISCORD_TOKEN=<bot token> bun packages/omo-gateway/src/adapters/discord/qa.ts --live --account <bot user id> --channel <test channel id>
//
// Live mode needs a bot token (never a user token) for a bot in a dedicated test channel.
import { parseArgs } from "node:util"
import type { InboundEvent, SurfaceKey } from "../../adapter/contract"
import { parseRich } from "../../adapter/rich"
import { DiscordAdapter } from "./adapter"
import { realClock } from "./clock"
import { DiscordRest } from "./rest"
import { FakeDiscordServer, FAKE_TOKEN } from "./testing/fake-server"
import { FAKE_BOT, FAKE_GUILD } from "./testing/fake-state"
import { isJson } from "./wire"

type Step = { step: string; ok: boolean; detail: unknown }
type Target = { token: string; account_id: string; channel_id: string; apiBase: string; gatewayUrl: string; guild_id?: string; fake: FakeDiscordServer | null }

function target(): Target {
  const { values } = parseArgs({ options: { fake: { type: "boolean" }, live: { type: "boolean" }, account: { type: "string" }, channel: { type: "string" } } })
  if (values.live === true) {
    const token = process.env.OMO_GATEWAY_QA_DISCORD_TOKEN ?? ""
    if (token === "" || values.account === undefined || values.channel === undefined) {
      throw new Error("--live needs OMO_GATEWAY_QA_DISCORD_TOKEN, --account <bot user id> and --channel <test channel id>")
    }
    return { token, account_id: values.account, channel_id: values.channel, apiBase: "https://discord.com/api/v10", gatewayUrl: "wss://gateway.discord.gg", fake: null }
  }
  const fake = new FakeDiscordServer()
  return { token: FAKE_TOKEN, account_id: FAKE_BOT.id, channel_id: fake.chat.chat_id, apiBase: fake.apiBase, gatewayUrl: fake.gatewayUrl, guild_id: FAKE_GUILD, fake }
}

async function run(t: Target): Promise<{ steps: Step[]; cleanup: Step[] }> {
  const steps: Step[] = []
  const cleanup: Step[] = []
  const record = (list: Step[], step: string, ok: boolean, detail: unknown) => list.push({ step, ok, detail })
  const adapter = new DiscordAdapter({ account_id: t.account_id, token: t.token, apiBase: t.apiBase, gatewayUrl: t.gatewayUrl, chats: [t.channel_id], ...(t.guild_id === undefined ? {} : { guild_id: t.guild_id }) })
  const rest = new DiscordRest({ token: t.token, apiBase: t.apiBase, fetch, clock: realClock })
  const chat: SurfaceKey = { platform: "discord", account_id: t.account_id, chat_id: t.channel_id, thread_id: null }
  const stamp = new Date().toISOString()
  const opened = await adapter.send({ op: "open_thread", key: chat, root: parseRich(`*gateway QA* ${stamp}`) })
  const thread = opened.created
  record(steps, "open_thread", thread !== null && thread.thread_id !== null, { root_message_id: opened.message_id, thread_id: thread?.thread_id ?? null, permalink: opened.permalink })
  if (thread === null || thread.thread_id === null) return { steps, cleanup }
  const posted = await adapter.send({ op: "post", key: thread, body: parseRich("progress: step 1 of 2") })
  record(steps, "post", posted.message_id !== "", { message_id: posted.message_id })
  await adapter.send({ op: "edit", key: thread, message_id: posted.message_id, body: parseRich("progress: *done* (see <https://example.invalid/qa|the QA note>)") })
  const edited = await rest.request("GET", `/channels/${thread.thread_id}/messages/${posted.message_id}`).catch(() => null)
  const fakeEdited = t.fake?.state.messages.get(posted.message_id)?.content ?? null
  const content = isJson(edited) && typeof edited.content === "string" ? edited.content : fakeEdited
  record(steps, "edit", content === "progress: **done** \\(see [the QA note](<https://example.invalid/qa>)\\)", { content })
  await adapter.send({ op: "react", key: thread, message_id: posted.message_id, name: "done" })
  const reactions = t.fake === null ? "not read back live" : [...(t.fake.state.messages.get(posted.message_id)?.reactions.keys() ?? [])]
  record(steps, "react", t.fake === null || (Array.isArray(reactions) && reactions.includes("\u{2705}")), { reactions })
  if (t.fake !== null) record(steps, "listen_thread_reply", true, await listenForReply(adapter, t.fake, thread))
  await adapter.send({ op: "archive_thread", key: thread })
  const readBack = await rest.request("GET", `/channels/${thread.thread_id}`)
  const archived = isJson(readBack) && isJson(readBack.thread_metadata) ? readBack.thread_metadata.archived : null
  record(steps, "archive_thread -> GET /channels/{thread}", archived === true, { thread_metadata: isJson(readBack) ? readBack.thread_metadata : null })
  if (t.fake === null) {
    await rest.request("DELETE", `/channels/${thread.thread_id}`).then(
      () => record(cleanup, "delete thread", true, thread.thread_id),
      (error: unknown) => record(cleanup, "delete thread", false, String(error)),
    )
    await rest.request("DELETE", `/channels/${t.channel_id}/messages/${opened.message_id}`).then(
      () => record(cleanup, "delete root message", true, opened.message_id),
      (error: unknown) => record(cleanup, "delete root message", false, String(error)),
    )
  }
  return { steps, cleanup }
}

async function listenForReply(adapter: DiscordAdapter, fake: FakeDiscordServer, thread: SurfaceKey): Promise<unknown> {
  const controller = new AbortController()
  const arrived = new Promise<InboundEvent>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("no thread reply within 5 s")), 5000)
    const listening = adapter.listen(
      (event) => {
        if (event.text !== "human reply in the QA thread") return
        clearTimeout(timer)
        resolve(event)
      },
      controller.signal,
      () => fake.humanPost({ channel_id: thread.thread_id ?? thread.chat_id, content: "human reply in the QA thread" }),
    )
    listening.catch(reject)
  })
  try {
    const event = await arrived
    return { kind: event.kind, key: event.key, event_id: event.event_id }
  } finally {
    controller.abort()
  }
}

const t = target()
try {
  const result = await run(t)
  const ok = result.steps.every((step) => step.ok) && result.cleanup.every((step) => step.ok)
  const report = { mode: t.fake === null ? "live" : "fake", ok, at: new Date().toISOString(), ...result }
  if (t.fake !== null) {
    t.fake.stop()
    report.cleanup.push({ step: "stop fake Discord server", ok: true, detail: "Bun.serve stopped; no files written" })
  }
  console.log(JSON.stringify(report, null, 2))
  process.exit(ok ? 0 : 1)
} catch (error) {
  t.fake?.stop()
  console.error(`discord QA failed: ${error instanceof Error ? error.message : String(error)}`)
  process.exit(1)
}
