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

  test("#given b is mid-turn and its user's draft holds the default-mode steer #when the draft goes after the turn ended #then the re-send is a follow-up under the same delivery id and the message is taken, never a turn_conflict the sender does not see", async () => {
    // b answers the probe mid-turn on turn 3 and holds the first admit behind its draft; by the re-send its turn is over.
    let reads = 0
    const engine = { ...ENGINE, pending: 1, currentTurnId: "3", get streaming() { return reads++ < 2 } }
    const a = account({ heldDraft: 1, engine })
    const { relay, log } = transport(a.remote)
    const first = await relay.deliver(delivery("steer me", "k6"))
    expect(first).toMatchObject({ kind: "ok", device: "b", delivery: { kind: "queued", queue_position: 1 }, effective_mode: "follow_up" })
    await admitted(a.sent, 2)
    const records = admits(a.sent)
    expect(records.map((record) => [record["deliverAs"], record["expectedTurnId"] ?? null])).toEqual([["steer", "3"], ["followUp", null]])
    expect(new Set(records.map((record) => record["deliveryId"])).size).toBe(1)
    expect(String(records[1]?.["text"])).toContain(" requested=auto effective=follow_up ")
    expect(log.filter((line) => line.startsWith("relay_delivery_failed:"))).toEqual([])
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
    // The armed wait is released after the dispose: a dispose that did nothing would let the re-send go out here.
    for (const wait of waits.splice(0)) wait.release()
    await new Promise((resolve) => setTimeout(resolve, 20))
    expect(admits(a.sent)).toHaveLength(1)
  })

  test.each([
    ["held_draft", { heldDraft: 1 }, false],
    ["already_admitted", { admitOutcome: { kind: "ok" as const, response: { type: "response", command: "admit_external_message", success: true, data: { kind: "already_admitted", turnId: "9" } } } }, true],
  ])("#given an IDLE receiver (pendingMessageCount 0) that answers %s #when a message is sent #then the send is queued at position 1 (the delivery is first in line there), never idempotency_uncertain", async (_kind, options, deduplicated) => {
    const a = account({ ...options, engine: { ...ENGINE, pending: 0 } })
    const { relay, released } = transport(a.remote)
    released.value = false
    expect(await relay.deliver(delivery("to an idle b", "k5"))).toMatchObject({ kind: "ok", device: "b", deduplicated, delivery: { kind: "queued", queue_position: 1 } })
    expect(admits(a.sent)).toHaveLength(1)
    relay.dispose()
  })

  // #12927: an explicit steer the draft holds is answered queued; when its turn is over by the re-send, the sender can read the refusal.
  const steer = (key: string): OutboundDelivery => ({ ...delivery("steer me", key), mode: "steer", expected_turn_id: "3" })

  test("#given b streams turn 3 and its user's draft holds one admission #when a steer of turn 3 is sent and turn 3 ends before the re-send #then the send answered queued, and a retry under the same key replays turn_conflict naming the delivery", async () => {
    const engine = { ...ENGINE, streaming: true, currentTurnId: "3", pending: 0 }
    const a = account({ heldDraft: 1, engine })
    // Subscribed before the send: the re-send's failure line is written after the receipt is revised.
    const log: string[] = []
    let failed: () => void = () => undefined
    const failure = new Promise<void>((resolve) => { failed = resolve })
    // Turn 3 ends while the draft holds the steer: the wait before the re-send is where it ends.
    const { relay } = transport(a.remote, { retryDelay: async () => { engine.streaming = false }, log: (line) => { log.push(line); if (line.startsWith("relay_delivery_failed:")) failed() } })
    expect(await relay.deliver(steer("s1"))).toMatchObject({ kind: "ok", device: "b", delivery: { kind: "queued", queue_position: 1 }, effective_mode: "steer" })
    let breaker: ReturnType<typeof setTimeout> | undefined
    await Promise.race([failure, new Promise<never>((_, reject) => { breaker = setTimeout(() => reject(new Error(`waited 5 s for the re-send's failure line; log: ${log.join(" | ")}`)), 5_000) })]).finally(() => clearTimeout(breaker))
    expect(admits(a.sent)).toHaveLength(2)
    const deliveryId = String(admits(a.sent)[0]?.["deliveryId"])
    expect(await relay.deliver(steer("s1"))).toMatchObject({ kind: "error", error: { code: "turn_conflict", details: { device: "b", delivery_id: deliveryId } } })
    expect(admits(a.sent)).toHaveLength(2)
    expect(log.filter((line) => line.startsWith("relay_receipt_unrevised:"))).toEqual([])
  })

  test("#given a held steer whose turn still runs at the re-send #when b takes it #then a retry under the same key still replays the queued answer", async () => {
    const a = account({ heldDraft: 1, engine: { ...ENGINE, streaming: true, currentTurnId: "3", pending: 0 } })
    const { relay, log } = transport(a.remote)
    expect(await relay.deliver(steer("s2"))).toMatchObject({ kind: "ok", delivery: { kind: "queued" }, effective_mode: "steer" })
    await admitted(a.sent, 2)
    expect(await relay.deliver(steer("s2"))).toMatchObject({ kind: "ok", deduplicated: true, delivery: { kind: "queued", queue_position: 1 } })
    expect(log.filter((line) => line.startsWith("relay_delivery_failed:"))).toEqual([])
  })


  test("#12886: #given b is parked on a tool PERMISSION prompt (get_state has an open dialog, streaming, pendingMessageCount 0) #when a default-mode message is sent #then it is queued behind the approval with waiting_on, not steered into the parked turn", async () => {
    const a = account({ engine: { ...ENGINE, streaming: true, pending: 0, currentTurnId: "7", pendingDialogs: [{ id: "perm-1", kind: "permission" }] } })
    const { relay } = transport(a.remote)
    expect(await relay.deliver(delivery("while b waits on a permission", "k7"))).toMatchObject({ kind: "ok", device: "b", effective_mode: "follow_up", delivery: { kind: "queued", queue_position: 1, waiting_on: { kind: "approval", device: "b" } } })
    expect(admits(a.sent)).toHaveLength(1)
    relay.dispose()
  })

  test("#12886: #given b is parked on an approval (get_state has an open question, pendingMessageCount 0) #when a message is sent #then the send is queued with waiting_on approval on b, not idempotency_uncertain", async () => {
    const a = account({ engine: { ...ENGINE, streaming: true, pending: 0, currentTurnId: "7", pendingQuestions: [{ id: "q-1", kind: "permission" }] } })
    const { relay } = transport(a.remote)
    expect(await relay.deliver(delivery("while b waits on a human", "k6"))).toMatchObject({ kind: "ok", device: "b", delivery: { kind: "queued", queue_position: 1, waiting_on: { kind: "approval", device: "b" } } })
    expect(admits(a.sent)).toHaveLength(1)
    relay.dispose()
  })

  test("#given b already holds the delivery (a lost reply retried) #when the retry reaches b #then the send is deduplicated at b's real pending count, not an invented 1", async () => {
    const a = account({ admitOutcome: { kind: "ok", response: { type: "response", command: "admit_external_message", success: true, data: { kind: "already_admitted", turnId: "9" } } }, engine: { ...ENGINE, streaming: true, pending: 3 } })
    const { relay } = transport(a.remote)
    expect(await relay.deliver(delivery("again", "k4"))).toMatchObject({ kind: "ok", device: "b", deduplicated: true, delivery: { kind: "queued", queue_position: 3 } })
  })
})
