import { afterEach, describe, expect, test } from "bun:test"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { createGatewayStore, type GatewayStore } from "../gateway/store"
import type { OutboundDelivery } from "../gateway/transport"
import { B_ROW, createRemoteThreadFixture, ENGINE } from "../thread-remote-fixture"
import { createRelayTransport } from "./relay-transport"

const { account, cleanup } = createRemoteThreadFixture()
const directories: string[] = []
const stores: GatewayStore[] = []
afterEach(async () => {
  await cleanup()
  await Promise.all(stores.splice(0).map((store) => store.dispose()))
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true })
})

type Sent = { readonly rpc?: Readonly<Record<string, unknown>> }
const admits = (sent: readonly Sent[]) => sent.filter((entry) => entry.rpc?.["type"] === "admit_external_message").map((entry) => entry.rpc ?? {})

function transport(remote: Parameters<typeof createRelayTransport>[0]["remote"], extra: Partial<Parameters<typeof createRelayTransport>[0]> = {}) {
  const agentDir = mkdtempSync(join(tmpdir(), "relay-transport-"))
  directories.push(agentDir)
  const store = createGatewayStore({ agentDir })
  stores.push(store)
  const log: string[] = []
  // Every background wait resolves at once unless the test holds it: the schedule, not the clock, is under test.
  const waits: Array<{ readonly ms: number; readonly release: () => void }> = []
  const released = { value: true }
  const retryDelay = (ms: number, signal: AbortSignal) => new Promise<void>((resolve) => {
    if (released.value || signal.aborted) return resolve()
    waits.push({ ms, release: resolve })
    signal.addEventListener("abort", () => resolve(), { once: true })
  })
  const relay = createRelayTransport({ remote, store, senderProvenance: async () => ({ workspace: "w", project: "p" }), log: (line) => log.push(line), heldRetryDelaysMs: [5, 15, 30], retryDelay, ...extra })
  return { relay, log, waits, released }
}

const delivery = (text: string, key: string): OutboundDelivery => ({
  sender: { kind: "session", durable_id: "dur-caller", name: "planner" },
  caller_id: "dur-caller",
  target: { kind: "remote", row: B_ROW },
  text,
  mode: "auto",
  idempotency_key: key,
  args: { thread: B_ROW.session_id, message: text },
})

/** Waits for `count` admit records on the fixture, failing with the records seen so far instead of hanging. */
async function admitted(sent: readonly Sent[], count: number): Promise<void> {
  const deadline = Date.now() + 5_000
  while (admits(sent).length < count) {
    if (Date.now() > deadline) throw new Error(`waited 5 s for ${count} admit records, saw ${admits(sent).length}`)
    await new Promise((resolve) => setTimeout(resolve, 5))
  }
}

describe("a delivery the receiver's open draft holds is queued at once, like a same-device one, and re-sent in the background", () => {
  test("#given b's user has a draft open that holds two admissions #when a message is sent #then the send answers queued at b's pending count at once, the same record reaches b three times, and the third is taken", async () => {
    const a = account({ heldDraft: 2, engine: { ...ENGINE, pending: 2 } })
    const { relay, log } = transport(a.remote)
    const first = await relay.deliver(delivery("hold me", "k1"))
    expect(first).toMatchObject({ kind: "ok", device: "b", delivery: { kind: "queued", queue_position: 2 }, deduplicated: false })
    await admitted(a.sent, 3)
    const records = admits(a.sent)
    expect(new Set(records.map((record) => record["deliveryId"])).size).toBe(1)
    expect(records.map((record) => record["text"])).toEqual([records[0]?.["text"], records[0]?.["text"], records[0]?.["text"]])
    expect(log.filter((line) => line.startsWith("relay_delivery_held:"))).toHaveLength(2)
    expect(log.filter((line) => line.startsWith("relay_delivery_failed:"))).toEqual([])
    // The receiver took the third; nothing more is sent and a retry of the send under its key replays the first answer.
    expect(await relay.deliver(delivery("hold me", "k1"))).toMatchObject({ kind: "ok", deduplicated: true, delivery: { kind: "queued", queue_position: 2 } })
    expect(admits(a.sent)).toHaveLength(3)
  })

  test("#given a draft that outlasts every re-send #when the schedule is exhausted #then the send already answered queued, the re-sends stop, and one failure line names the delivery", async () => {
    const a = account({ heldDraft: 10, engine: { ...ENGINE, pending: 1 } })
    const { relay, log } = transport(a.remote)
    expect(await relay.deliver(delivery("still held", "k2"))).toMatchObject({ kind: "ok", delivery: { kind: "queued", queue_position: 1 } })
    await admitted(a.sent, 4)
    expect(admits(a.sent)).toHaveLength(4)
    expect(log.filter((line) => line.startsWith("relay_delivery_failed:"))).toHaveLength(1)
    expect(log.at(-1)).toContain(String(admits(a.sent)[0]?.["deliveryId"]))
  })

  test("#given a held delivery whose re-send is waiting #when the transport is disposed #then no further record is sent", async () => {
    const a = account({ heldDraft: 10, engine: { ...ENGINE, pending: 1 } })
    const { relay, waits, released } = transport(a.remote)
    released.value = false
    expect(await relay.deliver(delivery("abandoned", "k3"))).toMatchObject({ kind: "ok", delivery: { kind: "queued" } })
    await admitted(a.sent, 1)
    const deadline = Date.now() + 5_000
    while (waits.length === 0) {
      if (Date.now() > deadline) throw new Error("waited 5 s for the first background wait to be armed")
      await new Promise((resolve) => setTimeout(resolve, 5))
    }
    relay.dispose()
    await new Promise((resolve) => setTimeout(resolve, 20))
    expect(admits(a.sent)).toHaveLength(1)
  })

  test("#given b already holds the delivery (a lost reply retried) #when the retry reaches b #then the send is deduplicated at b's real pending count, not an invented 1", async () => {
    const a = account({ admitOutcome: { kind: "ok", response: { type: "response", command: "admit_external_message", success: true, data: { kind: "already_admitted", turnId: "9" } } }, engine: { ...ENGINE, streaming: true, pending: 3 } })
    const { relay } = transport(a.remote)
    expect(await relay.deliver(delivery("again", "k4"))).toMatchObject({ kind: "ok", device: "b", deduplicated: true, delivery: { kind: "queued", queue_position: 3 } })
  })
})
