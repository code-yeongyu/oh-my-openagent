import { afterEach, describe, expect, test } from "bun:test"
import { join } from "node:path"

import { createFakeDeliveryService } from "../consumer/testing/fake-delivery-service"
import { createGatewayHarness, type GatewayHarness } from "../gateway/testing/harness"
import type { IntakeRequest } from "../gateway/types"
import { startDeliveryConsumer } from "./consumer-start"
import { writeSessionFile } from "./testing/fake-wake-host"

// #13456's LOW 1: the consumer is acknowledged as serving BEFORE its startup pending sweep runs, so a remote row that
// sweep wakes cannot read the carrier's gate as off.

const TARGET = "dur-target"
let harness: GatewayHarness | undefined
afterEach(async () => {
  await harness?.dispose()
  harness = undefined
})

describe("startDeliveryConsumer", () => {
  test("#given a session whose queued row waits from another device #when the consumer starts and its pending sweep wakes it #then the serving acknowledgement is reported before the wake", async () => {
    const h = (harness = createGatewayHarness())
    const store = h.store()
    writeSessionFile(join(h.agentDir, "sessions"), TARGET, { cwd: process.cwd() })
    const request: IntakeRequest = {
      now: h.clock.now,
      attested_device: "device-b",
      record: {
        sessionId: TARGET,
        deliveryId: "d-early",
        text: "OMO_GATEWAY v=1\nsource=peer_agent\nd-early",
        displayText: "d-early",
        sender: { kind: "agent", session_id: "sender-on-b" },
        deliverAs: "followUp",
        chainCount: 1,
      },
      provenance: { workspace: "remote", project: "remote" },
      target_session_kind: "interactive",
    }
    expect((await store.intake(request)).kind).toBe("queued")
    const service = createFakeDeliveryService({ admitted: true })
    service.ackServe({ wake: true })
    const order: string[] = []
    const started = await startDeliveryConsumer({
      store,
      agentDir: h.agentDir,
      sessionsDirectory: join(h.agentDir, "sessions"),
      deliveries: async () => service.port,
      engineVersion: "2026.12.1",
      minimumEngine: "2026.12.1",
      wake: async (durableId) => {
        order.push(`wake:${durableId}`)
      },
      sameDevice: () => false,
      onServing: () => {
        order.push("serving")
      },
      log: () => undefined,
    })
    expect(started).toBeDefined()
    expect(order).toEqual(["serving", `wake:${TARGET}`])
    started?.consumer.stop()
  })
})
