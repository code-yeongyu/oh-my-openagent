import { Database } from "bun:sqlite"
import { afterEach, describe, expect, test } from "bun:test"
import { join } from "node:path"

import { gatewayDatabasePath } from "../gateway/paths"
import { GATEWAY_MIGRATIONS } from "../gateway/schema"
import { createGatewayHarness, type GatewayHarness } from "../gateway/testing/harness"
import { writeSessionFile } from "../wake/testing/fake-wake-host"
import { createDeliveryConsumer, type DeliveryConsumer } from "./consumer"
import { createFakeDeliveryService, type FakeDeliveryService } from "./testing/fake-delivery-service"

// The consumer (#13037 design 5.4 receiving half, 5.12, A2.4, A2.14): an engine process's side of the device service's
// delivery protocol, behind a port. It declares, takes a handed record in through the intake, answers from the row,
// asks the service whether the sender is still admitted, and only then wakes the session.

let harness: GatewayHarness | undefined
const consumers: DeliveryConsumer[] = []
afterEach(async () => {
  for (const consumer of consumers.splice(0)) consumer.stop()
  await harness?.dispose()
  harness = undefined
})

function record(deliveryId: string, sessionId = "t"): Record<string, unknown> {
  return {
    type: "admit_external_message",
    sessionId,
    deliveryId,
    text: `OMO_GATEWAY v=1\nsource=peer_agent\n\n${deliveryId}`,
    displayText: deliveryId,
    sender: { kind: "agent", session_id: "sender-s" },
    deliverAs: "followUp",
    chainCount: 1,
  }
}

function setup(options: { readonly admitted?: boolean } = {}) {
  const h = (harness = createGatewayHarness())
  const service: FakeDeliveryService = createFakeDeliveryService({ admitted: options.admitted ?? true })
  const sessions = join(h.agentDir, "sessions")
  const woken: string[] = []
  const store = h.store()
  const consumer = createDeliveryConsumer({
    store,
    port: service.port,
    agentDir: h.agentDir,
    sessionsDirectory: sessions,
    wake: async (durableId) => {
      woken.push(durableId)
    },
  })
  consumers.push(consumer)
  return { h, service, sessions, woken, store, consumer }
}

describe("declaring", () => {
  test("#given a service that serves consumers #when the consumer starts #then it declares this agent directory with protocol version 1 and reports an empty pending list", async () => {
    const { h, service, consumer } = setup()
    expect(await consumer.start()).toBe("serving")
    expect(service.calls).toEqual([
      { type: "deliveries.serve", agent_dir: h.agentDir, v: 1 },
      { type: "delivery.pending", pairs: [] },
    ])
  })

  test("#given an older service #when the declaration is answered unknown_type #then the consumer serves nothing and sends nothing else", async () => {
    const { service, consumer } = setup()
    service.refuseServe("unknown_type")
    expect(await consumer.start()).toBe("unsupported")
    expect(service.calls).toEqual([{ type: "deliveries.serve", agent_dir: expect.any(String), v: 1 }])
  })

  test("#given a store written by a newer build #when an older consumer starts #then it declares nothing", async () => {
    const { h, service, consumer } = setup()
    await h.store().identity()
    const db = new Database(gatewayDatabasePath(h.agentDir))
    try {
      db.exec(`PRAGMA user_version = ${GATEWAY_MIGRATIONS.length + 1}`)
    } finally {
      db.close()
    }
    expect(await consumer.start()).toBe("schema_too_new")
    expect(service.calls).toEqual([])
  })
})

describe("a handed delivery", () => {
  test("#given a session that is not running #when a record is handed in #then the row is committed before the answer, the answer is queued, and the session is woken after the sender is admitted", async () => {
    const { h, service, sessions, woken, consumer } = setup()
    writeSessionFile(sessions, "t")
    await consumer.start()
    let committedAtAnswer = -1
    service.onAnswer(async () => {
      committedAtAnswer = (await h.store().list({ target_durable_id: "t" })).length
    })
    const reply = await service.inbound({ command_id: "c-1", sender_device: "dev-a", durable_id: "t", record: record("d-1") })
    expect(reply).toMatchObject({ kind: "queued", delivery_id: "d-1", deduplicated: false, waiting_on: { kind: "wake" } })
    expect(committedAtAnswer).toBe(1)
    await consumer.idle()
    expect(service.calls).toContainEqual({ type: "peer.admitted", device: "dev-a" })
    expect(woken).toEqual(["t"])
  })

  test("#given a record repeated by the same device #when it is handed in again #then the answer comes from the row with deduplicated set, and the admission check and the wake still run", async () => {
    const { sessions, service, woken, consumer } = setup()
    writeSessionFile(sessions, "t")
    await consumer.start()
    await service.inbound({ command_id: "c-1", sender_device: "dev-a", durable_id: "t", record: record("d-1") })
    const again = await service.inbound({ command_id: "c-2", sender_device: "dev-a", durable_id: "t", record: record("d-1") })
    expect(again).toMatchObject({ kind: "queued", delivery_id: "d-1", deduplicated: true })
    await consumer.idle()
    expect(woken).toEqual(["t", "t"])
  })

  test.each([
    ["no session file", (_sessions: string) => undefined, "session_gone"],
    [
      "two session files",
      (sessions: string) => {
        writeSessionFile(sessions, "t", {}, "--tmp-one--")
        writeSessionFile(sessions, "t", {}, "--tmp-two--")
      },
      "ambiguous_session",
    ],
    [
      "a child session",
      (sessions: string) => {
        writeSessionFile(sessions, "t", { spawnedBy: { parentSessionId: "p", rootSessionId: "p", taskId: "x" } })
      },
      "not_wakeable",
    ],
  ])(
    "#given %s #when a record is handed in #then it is refused before any commit and nothing is woken",
    async (_label, arrange, reason) => {
      const { h, sessions, service, woken, consumer } = setup()
      arrange(sessions)
      await consumer.start()
      const reply = await service.inbound({ command_id: "c-1", sender_device: "dev-a", durable_id: "t", record: record("d-1") })
      expect(reply).toEqual({ kind: "refused", reason })
      await consumer.idle()
      expect(await h.store().list({ target_durable_id: "t" })).toEqual([])
      expect(woken).toEqual([])
    },
  )

  test("#given a sender the service no longer admits #when the record is handed in #then it is answered queued, then settled refused sender_not_admitted, and nothing is woken", async () => {
    const { h, sessions, service, woken, consumer } = setup({ admitted: false })
    writeSessionFile(sessions, "t")
    await consumer.start()
    await service.inbound({ command_id: "c-1", sender_device: "dev-a", durable_id: "t", record: record("d-1") })
    await consumer.idle()
    expect(await h.store().list({ target_durable_id: "t" })).toMatchObject([
      { state: "refused", reason: "sender_not_admitted" },
    ])
    expect(woken).toEqual([])
  })

  test("#given two sender devices that use the same command id #when both hand a record in #then each gets its own answer, keyed by its own sender device", async () => {
    const { sessions, service, consumer } = setup()
    writeSessionFile(sessions, "t")
    await consumer.start()
    const [fromA, fromB] = await Promise.all([
      service.inbound({ command_id: "same", sender_device: "dev-a", durable_id: "t", record: record("d-a") }),
      service.inbound({ command_id: "same", sender_device: "dev-b", durable_id: "t", record: record("d-b") }),
    ])
    expect(fromA).toMatchObject({ kind: "queued", delivery_id: "d-a" })
    expect(fromB).toMatchObject({ kind: "queued", delivery_id: "d-b" })
  })

  test("#given a question whether this directory holds a durable id #when it is asked #then it answers from the session files here", async () => {
    const { sessions, service, consumer } = setup()
    writeSessionFile(sessions, "t")
    await consumer.start()
    expect(await service.holds({ ask_id: "a-1", durable_id: "t" })).toBe(true)
    expect(await service.holds({ ask_id: "a-2", durable_id: "other" })).toBe(false)
  })
})

describe("the hand-over mark", () => {
  test("#given two deliveries of one pair #when only the first is applied #then no drained report is sent, and the report after both carries the newest command id", async () => {
    const { h, sessions, service, consumer } = setup()
    writeSessionFile(sessions, "t")
    await consumer.start()
    const target = h.session("t")
    await service.inbound({ command_id: "c-1", sender_device: "dev-a", durable_id: "t", record: record("d-1") })
    await target.drain.drain({ reason: "command" })
    await h.quiesce()
    await service.inbound({ command_id: "c-2", sender_device: "dev-a", durable_id: "t", record: record("d-2") })
    await consumer.reportDrained()
    expect(service.calls.filter((call) => call.type === "delivery.drained")).toEqual([])

    await target.drain.drain({ reason: "command" })
    await h.quiesce()
    await consumer.reportDrained()
    expect(service.calls.filter((call) => call.type === "delivery.drained")).toEqual([
      { type: "delivery.drained", sender_device: "dev-a", session_id: "t", last_command_id: "c-2" },
    ])
  })

  test("#given an older service that does not know the drained report #when the consumer reports #then it goes on as if no mark were kept", async () => {
    const { h, sessions, service, consumer } = setup()
    writeSessionFile(sessions, "t")
    await consumer.start()
    service.refuseMarks("unknown_type")
    await service.inbound({ command_id: "c-1", sender_device: "dev-a", durable_id: "t", record: record("d-1") })
    const target = h.session("t")
    await target.drain.drain({ reason: "command" })
    await h.quiesce()
    expect(await consumer.reportDrained()).toBeUndefined()
  })
})
