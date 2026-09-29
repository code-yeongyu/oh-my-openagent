import type { Capabilities } from "../contract"
import type { Check } from "./types"
import { collectCatchUp, collectInbound, expect } from "./wait"

const BOOLEAN_FLAGS = [
  "edit",
  "reactions",
  "typing",
  "threads",
  "thread_archive",
  "buttons",
  "streaming",
  "draft_stream",
  "uploads",
  "rich_links",
  "presence",
  "chat_create",
] as const satisfies readonly (keyof Capabilities)[]

export const capabilitiesShape: Check = async ({ makeAdapter, fixtures }) => {
  const adapter = await makeAdapter()
  const caps = adapter.capabilities()
  for (const flag of BOOLEAN_FLAGS) expect(typeof caps[flag] === "boolean", `capabilities().${flag} must be a boolean`)
  expect(Number.isInteger(caps.max_text) && caps.max_text > 0, "capabilities().max_text must be a positive integer")
  expect(adapter.platform === fixtures.chat.platform, `adapter.platform ${adapter.platform} differs from fixtures.chat.platform ${fixtures.chat.platform}`)
  return `${BOOLEAN_FLAGS.filter((flag) => caps[flag]).length} of ${BOOLEAN_FLAGS.length} flags true, max_text ${caps.max_text}`
}

export const eventIdUnique: Check = async ({ makeAdapter, fixtures, timeoutMs, marker }) => {
  const adapter = await makeAdapter()
  const markers = [marker("unique-a"), marker("unique-b"), marker("unique-c")]
  const seen = await collectInbound(
    adapter,
    markers,
    async () => {
      for (const text of markers) await fixtures.humanPost({ key: fixtures.chat, text })
    },
    timeoutMs,
  )
  const events = markers.map((text) => seen.get(text)?.[0])
  const ids = new Set<string>()
  for (const [index, event] of events.entries()) {
    expect(event !== undefined, `no event for ${markers[index]}`)
    expect(event.event_id !== "", "event_id must be a non-empty string")
    expect(!ids.has(event.event_id), `event_id ${event.event_id} was reused for two different messages`)
    ids.add(event.event_id)
    expect(event.key.platform === fixtures.chat.platform && event.key.chat_id === fixtures.chat.chat_id, `event ${event.event_id} arrived with key ${JSON.stringify(event.key)}`)
    expect(!event.author.is_bot, `a human post arrived with author.is_bot true (${event.event_id})`)
    expect(!Number.isNaN(Date.parse(event.at)), `event ${event.event_id} has a non-ISO at: ${event.at}`)
    expect((event.kind === "reaction") === (event.reaction !== null), `event ${event.event_id}: reaction must be set exactly when kind is "reaction"`)
    expect((event.kind === "edit") === (event.edited !== null), `event ${event.event_id}: edited must be set exactly when kind is "edit"`)
  }
  return `3 human posts -> 3 distinct event_ids`
}

export const dedupeOnReplay: Check = async ({ makeAdapter, fixtures, timeoutMs, marker }) => {
  const since = new Date(Date.now() - 60_000).toISOString()
  const markers = [marker("replay-a"), marker("replay-b")]
  const live = await collectInbound(
    await makeAdapter(),
    markers,
    async () => {
      for (const text of markers) await fixtures.humanPost({ key: fixtures.chat, text })
    },
    timeoutMs,
  )
  const restarted = await makeAdapter()
  const first = await collectCatchUp(restarted, since, [fixtures.chat], timeoutMs)
  const second = await collectCatchUp(restarted, since, [fixtures.chat], timeoutMs)
  for (const text of markers) {
    const liveIds = new Set((live.get(text) ?? []).map((event) => event.event_id))
    for (const [label, replay] of [
      ["first catchUp", first],
      ["second catchUp", second],
    ] as const) {
      const replayed = replay.filter((event) => event.text.includes(text))
      expect(replayed.length > 0, `${label} after a restart did not replay ${text}`)
      for (const event of replayed) {
        expect(liveIds.has(event.event_id), `${label} replayed ${text} as ${event.event_id}, listen delivered it as ${[...liveIds].join(", ")}: dedupe would miss it`)
      }
    }
  }
  return "listen and catchUp (after a restart, twice) agree on every event_id"
}
