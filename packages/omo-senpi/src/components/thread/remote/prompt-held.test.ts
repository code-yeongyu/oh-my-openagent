import { afterEach, describe, expect, test } from "bun:test"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { createGatewayStore, type GatewayStore } from "../gateway/store"
import type { OutboundDelivery } from "../gateway/transport"
import { B_ROW, createRemoteThreadFixture, ENGINE } from "../thread-remote-fixture"
import { createRelayTransport } from "./relay-transport"

// #15093: a person's send to another device (`omo thread send`) takes the relay's prompt path. On a session its engine
// holds (a paused goal, a person's Stop), the engine queues the prompt without starting a turn and counts nothing
// pending; the answer was idempotency_uncertain with no id, and the message sat behind the hold.

const { account, cleanup } = createRemoteThreadFixture()
const directories: string[] = []
const stores: GatewayStore[] = []
afterEach(async () => {
  await cleanup()
  await Promise.all(stores.splice(0).map((store) => store.dispose()))
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true })
})

function relayFor(remote: Parameters<typeof createRelayTransport>[0]["remote"]) {
  const agentDir = mkdtempSync(join(tmpdir(), "prompt-held-"))
  directories.push(agentDir)
  const store = createGatewayStore({ agentDir })
  stores.push(store)
  return createRelayTransport({
    remote,
    store,
    senderProvenance: async () => ({ workspace: "w", project: "p" }),
    log: () => undefined,
  })
}

const personSend = (key: string): OutboundDelivery => ({
  sender: { kind: "person", uid: 1, user: "u" },
  caller_id: "person:1",
  target: { kind: "remote", row: B_ROW },
  text: "hello",
  mode: "follow_up",
  idempotency_key: key,
  client_message_id: `cm-${key}`,
  args: { target: "b", text: "hello" },
})

const queuedAdmission = (key: string) => ({
  disposition: "queued",
  clientMessageId: `cm-${key}`,
  admission: { clientMessageId: `cm-${key}`, disposition: "queued" },
})

describe("a person's send to a held session on another device", () => {
  test.each<[string, Record<string, unknown>]>([
    ["paused", { paused: true }],
    ["under a hold", { holds: [{ kind: "unattended" }] }],
  ])(
    "#given b's session is %s and its engine queues the prompt #when the person sends #then the answer is queued waiting on the hold, carrying the prompt's id",
    async (_label, liveState) => {
      const a = account({
        engine: { ...ENGINE, streaming: false, pending: 0 },
        liveState,
        promptResponse: queuedAdmission("h1"),
      })
      expect(await relayFor(a.remote).deliver(personSend("h1"))).toMatchObject({
        kind: "ok",
        delivery: { kind: "queued", waiting_on: { kind: "hold", device: B_ROW.device } },
        delivery_id: "cm-h1",
      })
    },
  )

  test("#given the engine admitted the prompt as queued but its state read reports nothing #when the person sends #then it is queued with the prompt's id, never uncertain", async () => {
    const a = account({ engine: { ...ENGINE, streaming: false, pending: 0 }, promptResponse: queuedAdmission("q1") })
    expect(await relayFor(a.remote).deliver(personSend("q1"))).toMatchObject({
      kind: "ok",
      delivery: { kind: "queued" },
      delivery_id: "cm-q1",
    })
  })

  test("#given a reply that names no admission and a state read that reports nothing #when the person sends #then the uncertain answer names the id to read", async () => {
    const a = account({ engine: { ...ENGINE, streaming: false, pending: 0 }, promptResponse: {} })
    expect(await relayFor(a.remote).deliver(personSend("u1"))).toMatchObject({
      kind: "error",
      error: { code: "idempotency_uncertain", details: { delivery_id: "cm-u1" } },
    })
  })
})
