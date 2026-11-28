import { afterEach, describe, expect, test } from "bun:test"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { createGatewayStore, type GatewayStore } from "../gateway/store"
import type { OutboundDelivery } from "../gateway/transport"
import { B_ROW, createRemoteThreadFixture, ENGINE } from "../thread-remote-fixture"
import { createRelayTransport } from "./relay-transport"

// #15374, security contract: on the relay's person path the delivery_id is persisted in the receipt and shown to the
// model. The id this side sent is the one it answers by; an id the receiving engine names is taken only when nothing
// was sent, and only within a bounded shape.

const { account, cleanup } = createRemoteThreadFixture()
const directories: string[] = []
const stores: GatewayStore[] = []
afterEach(async () => {
  await cleanup()
  await Promise.all(stores.splice(0).map((store) => store.dispose()))
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true })
})

function relayFor(remote: Parameters<typeof createRelayTransport>[0]["remote"]) {
  const agentDir = mkdtempSync(join(tmpdir(), "prompt-id-"))
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

function personSend(key: string, clientMessageId?: string): OutboundDelivery {
  return {
    sender: { kind: "person", uid: 1, user: "u" },
    caller_id: "person:1",
    target: { kind: "remote", row: B_ROW },
    text: "hello",
    mode: "follow_up",
    idempotency_key: key,
    ...(clientMessageId === undefined ? {} : { client_message_id: clientMessageId }),
    args: { target: "b", text: "hello" },
  }
}

const queuedNaming = (id: string) => ({
  disposition: "queued",
  admission: { clientMessageId: id, disposition: "queued" },
})
const idle = { ...ENGINE, streaming: false, pending: 0 }

describe("the delivery id of a person's send to another device", () => {
  test("#given the engine's reply names another id than the one sent #when the person sends #then the answer carries the sent id", async () => {
    const a = account({
      engine: idle,
      promptResponse: { ...queuedNaming("engine-picked"), clientMessageId: "engine-picked" },
    })
    const result = await relayFor(a.remote).deliver(personSend("s1", "cm-s1"))
    expect(result).toMatchObject({ kind: "ok", delivery_id: "cm-s1" })
  })

  test("#given nothing was sent and the engine names an oversized id #when the person sends #then no delivery id is adopted", async () => {
    const a = account({ engine: idle, promptResponse: queuedNaming("x".repeat(4096)) })
    const result = await relayFor(a.remote).deliver(personSend("s2"))
    expect(result).toMatchObject({ kind: "ok" })
    expect(result).not.toHaveProperty("delivery_id")
  })

  test("#given nothing was sent and the engine names an id with a newline #when the person sends #then no delivery id is adopted", async () => {
    const a = account({ engine: idle, promptResponse: queuedNaming("cm-ok\nInjected line") })
    expect(await relayFor(a.remote).deliver(personSend("s3"))).not.toHaveProperty("delivery_id")
  })

  test("#given nothing was sent and the engine names a well-formed id #when the person sends #then that id is the delivery id", async () => {
    const a = account({ engine: idle, promptResponse: queuedNaming("0193c2b8-7d4e-7a51-9f00-1b2c3d4e5f60") })
    expect(await relayFor(a.remote).deliver(personSend("s4"))).toMatchObject({
      kind: "ok",
      delivery_id: "0193c2b8-7d4e-7a51-9f00-1b2c3d4e5f60",
    })
  })
})
