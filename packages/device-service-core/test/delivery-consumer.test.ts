import { afterEach, describe, expect, test } from "bun:test"
import { chmodSync, mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { connectDeliveryConsumer, type DeliveryConsumerClient, LocalApiError } from "../src/index.ts"
import type { DeliveryInbound } from "../src/local-api/protocol.ts"
import { startFakeOwner, type FakeOwner } from "./local-api/conformance/fake-owner.ts"
import { defaultWorld, PEER, type WorldDeliveries } from "./local-api/conformance/world.ts"

// omo#13037: the engine process's delivery-consumer connection to its device service, the one client every consumer
// goes through. Against the reference owner: declare, take a handed record, answer it, ask about a sender device.

const owners: FakeOwner[] = []
const clients: DeliveryConsumerClient[] = []
const dirs: string[] = []
afterEach(async () => {
  for (const client of clients.splice(0)) client.close()
  for (const owner of owners.splice(0)) await owner.stop()
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

const HANDED = {
  command_id: "Y29tbWFuZC1pZC0wMDAwMQ",
  sender_device: PEER,
  durable_id: "dur-1",
  record: { type: "admit_external_message", deliveryId: "d-1" },
}

async function consumerOn(deliveries: WorldDeliveries | undefined) {
  const stateDir = mkdtempSync(join(tmpdir(), "dsc-deliveries-"))
  chmodSync(stateDir, 0o700)
  dirs.push(stateDir)
  const world = defaultWorld()
  owners.push(await startFakeOwner({ stateDir, world: deliveries === undefined ? world : { ...world, deliveries } }))
  const client = await connectDeliveryConsumer({ version: "5.1.70", stateDir })
  clients.push(client)
  return client
}

describe("the delivery consumer client", () => {
  test("#given a service that takes consumers for the agent dir #when the consumer declares, is handed a record and answers it #then each step goes through and the sender's admission reads back", async () => {
    const client = await consumerOn({ agent_dirs: ["/agents/a"], admitted: [PEER], handed: [HANDED] })
    const inbound = new Promise<DeliveryInbound>((resolve) => client.onInbound(resolve))
    expect(await client.serve({ agent_dir: "/agents/a", v: 1 })).toEqual({ wake: false })
    expect(await inbound).toEqual({ type: "event", kind: "delivery.inbound", ...HANDED })
    await client.answer({ sender_device: PEER, command_id: "Y29tbWFuZC1pZC0wMDAwMQ" }, { type: "response", success: true, data: {} })
    expect(await client.peerAdmitted(PEER)).toBe(true)
    expect(await client.peerAdmitted("dev-other")).toBe(false)
    await client.pending([{ sender_device: PEER, session_id: "dur-1", last_command_id: "Y29tbWFuZC1pZC0wMDAwMQ" }])
    expect(await client.drained({ sender_device: PEER, session_id: "dur-1", last_command_id: "Y29tbWFuZC1pZC0wMDAwMQ" })).toEqual({
      kept: false,
    })
  })

  test("#given a hand-off already answered #when it is answered again #then the refusal carries the code unknown_delivery", async () => {
    const client = await consumerOn({ agent_dirs: ["/agents/a"], handed: [HANDED] })
    await client.serve({ agent_dir: "/agents/a", v: 1 })
    await client.answer({ sender_device: PEER, command_id: "Y29tbWFuZC1pZC0wMDAwMQ" }, {})
    const refused = await client.answer({ sender_device: PEER, command_id: "Y29tbWFuZC1pZC0wMDAwMQ" }, {}).catch((error: unknown) => error)
    expect(refused).toBeInstanceOf(LocalApiError)
    expect((refused as LocalApiError).code).toBe("unknown_delivery")
  })

  test("#given a service that takes no consumers #when the consumer declares #then it is refused unsupported", async () => {
    const client = await consumerOn(undefined)
    const refused = await client.serve({ agent_dir: "/agents/a", v: 1 }).catch((error: unknown) => error)
    expect((refused as LocalApiError).code).toBe("unsupported")
  })

  test("#given the service asks whether this agent dir holds a session #when the consumer answers #then the question is closed", async () => {
    const client = await consumerOn({ agent_dirs: ["/agents/a"], asked: ["dur-9"] })
    const asked = new Promise<{ readonly ask_id: string; readonly durable_id: string }>((resolve) => client.onHolds(resolve))
    await client.serve({ agent_dir: "/agents/a", v: 1 })
    const question = await asked
    expect(question.durable_id).toBe("dur-9")
    await client.held(question.ask_id, false)
    const again = await client.held(question.ask_id, false).catch((error: unknown) => error)
    expect((again as LocalApiError).code).toBe("invalid_request")
  })
})
