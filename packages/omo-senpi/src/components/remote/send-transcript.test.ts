import { afterEach, describe, expect, test } from "bun:test"
import { startFakeOwner } from "../../../../device-service-core/test/local-api/conformance/fake-owner.ts"
import type { WorldPage } from "../../../../device-service-core/test/local-api/conformance/world.ts"
import { freshStateDir } from "../../../../device-service-core/test/local-api/support.ts"
import { pushRecords, reader, THREAD, worldWith } from "./attach.test-support"
import type { RemoteClient } from "./client"
import { clientOn, closeClients, fakeClock } from "./testing/fake-service"
import type { JsonObject, SendReceipt } from "./types"

// sessions.wait from a send on an engine that stamps no client message id (#13481 C'): no record of the send's turn
// carries its id, so the session's transcript decides, against what it held before the send went out. The rows drive
// the person client's real send and wait over the conformance owner; the session's history pages are the transcript.

const TEXT = "Reply with exactly the word pong"
const IDLE: JsonObject = { sessionId: "engine-1", isStreaming: false, pendingDialogs: [] }
// The engine's reply to every delegated command: its get_state is idle and it starts the prompt's turn at once.
const STARTED: JsonObject = { ...IDLE, pendingMessageCount: 0, disposition: "started", kind: "started", turnId: "7" }
// An id-less engine's run answering the prompt, as it streams it: no record carries a client message id.
const RUN: JsonObject[] = [
  { type: "agent_start" },
  { type: "message_start", message: { role: "user", content: TEXT } },
  { type: "message_end", message: { role: "user", content: TEXT } },
  {
    type: "message_update",
    message: {},
    assistantMessageEvent: { type: "text_delta", contentIndex: 0, delta: "pong" },
  },
  { type: "message_end", message: { role: "assistant", stopReason: "stop" } },
  { type: "agent_end", messages: [], willRetry: false },
  { type: "agent_settled" },
]
const user = (entry_id: string) => ({ entry_id, entry: { type: "message", message: { role: "user", content: TEXT } } })
const assistant = (entry_id: string, text: string) => ({
  entry_id,
  entry: { type: "message", message: { role: "assistant", content: [{ type: "text", text }], stopReason: "stop" } },
})
const EARLIER = [user("e-earlier"), assistant("e-earlier-answer", "EARLIER")]
const OWN = [user("e-own"), assistant("e-own-answer", "pong")]
const SETTLE_BOUND_MS = 5_000

const stops: (() => Promise<void>)[] = []
afterEach(async () => {
  await closeClients()
  for (const stop of stops.splice(0)) await stop()
})

const within = <T>(work: Promise<T>, what: string): Promise<T> => {
  let timer: ReturnType<typeof setTimeout> | undefined
  const expired = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`waited ${SETTLE_BOUND_MS} ms for ${what}`)), SETTLE_BOUND_MS)
  })
  return Promise.race([work, expired]).finally(() => clearTimeout(timer))
}

/** A session whose stored transcript starts as `stored`; `reads(n)` settles once the owner served its n-th history read. */
async function idLessSession(stored: WorldPage["entries"]) {
  const pages: WorldPage[] = [{ before_entry_id: null, entries: stored, next_before: null }]
  const base = worldWith(IDLE, [], { reply: STARTED })
  const world = { ...base, sessions: base.sessions.map((session) => ({ ...session, pages })) }
  let served = 0
  const waiters: { readonly count: number; readonly done: () => void }[] = []
  const owner = await startFakeOwner({
    stateDir: freshStateDir(),
    world,
    onRequest: (type) => {
      if (type !== "session.read") return
      served += 1
      for (const waiter of waiters.filter((candidate) => candidate.count <= served)) waiter.done()
    },
  })
  stops.push(owner.stop)
  const reads = (count: number): Promise<void> =>
    new Promise((done) => (count <= served ? done() : waiters.push({ count, done })))
  const store = (entries: WorldPage["entries"]): void => {
    pages[0] = { before_entry_id: null, entries, next_before: null }
  }
  return { owner, reads, store, client: clientOn(owner.stateDir, fakeClock()) }
}

// The caller's order, as `omo remote send --wait` takes it: the wait first, from the send it is about to make.
async function waitFromSend(client: RemoteClient) {
  const receipt = Promise.withResolvers<SendReceipt>()
  const waiting = client.sessions.wait(THREAD, { from: receipt.promise })
  let settled = false
  void waiting.then(() => (settled = true))
  const sent = await client.sessions.send(THREAD, { text: TEXT })
  if (sent.kind === "error") throw new Error(`the send failed: ${sent.code} ${sent.message}`)
  receipt.resolve(sent.value)
  // The wait's attach is open: a follow opened after it on the same connection has seen its opening state.
  await reader(client.sessions.follow(THREAD)).next("a follow opened after the wait")
  return { waiting, settled: () => settled }
}

describe("sessions.wait from a send on an engine that stamps no client message id (#13481)", () => {
  test("#given an id-less engine #when the send's own turn runs and settles #then wait settles on that turn", async () => {
    const { owner, store, client } = await idLessSession([])
    const { waiting } = await waitFromSend(client)
    store(OWN)
    pushRecords(owner, RUN)
    expect(await within(waiting, "the wait to settle on the send's own turn")).toMatchObject({
      kind: "ok",
      value: { outcome: "settled", status: "idle" },
    })
  })

  test("#given an earlier identical unstamped send stored before this send #when its run's settle arrives #then wait does not settle on it, only on this send's turn", async () => {
    const { owner, reads, store, client } = await idLessSession(EARLIER)
    const { waiting, settled } = await waitFromSend(client)
    // The pre-send view was the first history read; the earlier run's settle makes the wait read the transcript again.
    pushRecords(owner, [{ type: "agent_settled" }])
    await within(reads(2), "the wait's transcript read at the earlier run's settle")
    await reader(client.sessions.follow(THREAD)).next("a follow opened after that read was answered")
    expect(settled()).toBe(false)
    store([...EARLIER, ...OWN])
    pushRecords(owner, RUN)
    expect(await within(waiting, "the wait to settle on the send's own turn")).toMatchObject({
      kind: "ok",
      value: { outcome: "settled", status: "idle" },
    })
  })
})
