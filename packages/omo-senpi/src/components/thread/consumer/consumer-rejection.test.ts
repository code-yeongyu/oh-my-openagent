import { afterEach, expect, test } from "bun:test"
import { join } from "node:path"

import { createGatewayHarness, type GatewayHarness } from "../gateway/testing/harness"
import { writeSessionFile } from "../wake/testing/fake-wake-host"
import { createDeliveryConsumer, type DeliveryConsumer } from "./consumer"
import { createFakeDeliveryService } from "./testing/fake-delivery-service"

// Review LOW L2 of #13220: tracked work that rejects (a wake that fails, a refused answer, a refused held reply) must not
// leave an unhandled rejection in the engine process; the failure goes to the consumer's onError instead.

let harness: GatewayHarness | undefined
let consumer: DeliveryConsumer | undefined
afterEach(async () => {
  consumer?.stop()
  await harness?.dispose()
  harness = undefined
})

test("#given a wake that rejects #when a handed record is taken in #then the failure reaches onError and nothing is left unhandled", async () => {
  const h = (harness = createGatewayHarness())
  const service = createFakeDeliveryService({ admitted: true })
  const sessions = join(h.agentDir, "sessions")
  writeSessionFile(sessions, "t")
  const errors: unknown[] = []
  const unhandled: unknown[] = []
  const onUnhandled = (reason: unknown) => unhandled.push(reason)
  process.on("unhandledRejection", onUnhandled)
  try {
    consumer = createDeliveryConsumer({
      store: h.store(),
      port: service.port,
      agentDir: h.agentDir,
      sessionsDirectory: sessions,
      wake: async () => {
        throw new Error("wake failed")
      },
      onError: (error) => errors.push(error),
    })
    await consumer.start()
    await service.inbound({
      command_id: "c-1",
      sender_device: "dev-a",
      durable_id: "t",
      record: {
        type: "admit_external_message",
        sessionId: "t",
        deliveryId: "d-1",
        text: "OMO_GATEWAY v=1\nsource=peer_agent\n\nd-1",
        displayText: "d-1",
        sender: { kind: "agent", session_id: "sender-s" },
        deliverAs: "followUp",
        chainCount: 1,
      },
    })
    await consumer.idle()
    await new Promise<void>((resolve) => setImmediate(resolve))
    expect(errors.map((error) => (error as Error).message)).toEqual(["wake failed"])
    expect(unhandled).toEqual([])
  } finally {
    process.off("unhandledRejection", onUnhandled)
  }
})
