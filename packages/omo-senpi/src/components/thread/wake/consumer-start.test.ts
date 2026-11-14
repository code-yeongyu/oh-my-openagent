import { afterEach, describe, expect, test } from "bun:test"
import { mkdtempSync } from "node:fs"
import { join } from "node:path"

import { createFakeDeliveryService } from "../consumer/testing/fake-delivery-service"
import type { DeliveryConsumer } from "../consumer/consumer"
import type { DeliveryServicePort } from "../consumer/port"
import { createGatewayHarness, type GatewayHarness } from "../gateway/testing/harness"
import type { IntakeRequest } from "../gateway/types"
import type { GatewayStore } from "../gateway/store"
import { startDeliveryConsumer } from "./consumer-start"
import { writeSessionFile } from "./testing/fake-wake-host"

// The consumer start's contracts: it is acknowledged as serving before its startup pending sweep (that sweep reads
// `session_wake.same_device` for each swept session's OWN cwd, #13455's LOW with #13456's LOW 3), a start that fails
// closes its port and reports itself dead (#13457's LOW 1), a sweep that throws stops the consumer (#13456's delta
// LOW 2), and a connection that ends during the sweep never leaves a stale serving consumer behind (#13457's LOW 2).

const TARGET = "dur-target"
let harness: GatewayHarness | undefined
afterEach(async () => {
  await harness?.dispose()
  harness = undefined
})

function request(h: GatewayHarness, deliveryId: string): IntakeRequest {
  return {
    now: h.clock.now,
    attested_device: "device-b",
    record: {
      sessionId: TARGET,
      deliveryId,
      text: `OMO_GATEWAY v=1\nsource=peer_agent\n${deliveryId}`,
      displayText: deliveryId,
      sender: { kind: "agent", session_id: "sender-on-b" },
      deliverAs: "followUp",
      chainCount: 1,
    },
    provenance: { workspace: "remote", project: "remote" },
    target_session_kind: "interactive",
  }
}

function input(h: GatewayHarness, deliveries: () => Promise<DeliveryServicePort | undefined>) {
  return {
    store: h.store(),
    agentDir: h.agentDir,
    sessionsDirectory: join(h.agentDir, "sessions"),
    deliveries,
    engineVersion: "2026.12.1",
    minimumEngine: "2026.12.1",
    wake: async () => undefined,
    sameDevice: () => false,
    log: () => undefined,
  }
}

describe("startDeliveryConsumer", () => {
  test("#given a declaration the service refuses with an error #when the consumer starts #then the port is closed, the death is reported, and nothing serves", async () => {
    const h = (harness = createGatewayHarness())
    const died: string[] = []
    const service = createFakeDeliveryService({ admitted: true })
    service.refuseServe("internal_error")
    const serving = await startDeliveryConsumer({
      ...input(h, async () => service.port),
      onDied: () => {
        died.push("dead")
      },
    })
    expect(serving).toBeUndefined()
    expect(died).toEqual(["dead"])
    expect(await (service.port.closed ?? Promise.resolve()).then(() => true)).toBe(true)
  })

  test("#given the serving connection ends while the startup pending sweep runs #when the consumer finishes starting #then no stale serving consumer is returned", async () => {
    const h = (harness = createGatewayHarness())
    writeSessionFile(join(h.agentDir, "sessions"), TARGET, { cwd: process.cwd() })
    expect((await h.store().intake(request(h, "d-early"))).kind).toBe("queued")
    // The sweep's admission check is where the service restart lands: the connection ends under the sweep's feet.
    const service = createFakeDeliveryService({ admitted: true })
    service.ackServe({ wake: true })
    const closing: DeliveryServicePort = {
      ...service.port,
      peerAdmitted: async (device: string) => {
        service.port.close?.()
        return await service.port.peerAdmitted(device)
      },
    }
    const serving = await startDeliveryConsumer(input(h, async () => closing))
    expect(serving).toBeUndefined()
  })

  test("#given a session whose queued row waits from another device #when the consumer starts and its pending sweep wakes it #then the consumer already reads serving at the wake", async () => {
    const h = (harness = createGatewayHarness())
    const store = h.store()
    writeSessionFile(join(h.agentDir, "sessions"), TARGET, { cwd: process.cwd() })
    expect((await store.intake(request(h, "d-early"))).kind).toBe("queued")
    const service = createFakeDeliveryService({ admitted: true })
    service.ackServe({ wake: true })
    let created: DeliveryConsumer | undefined
    const order: string[] = []
    const started = await startDeliveryConsumer({
      ...input(h, async () => service.port),
      onConsumer: (consumer) => {
        created = consumer
      },
      wake: async (durableId) => {
        order.push(created?.serving() === true ? "serving" : "off", `wake:${durableId}`)
      },
    })
    expect(started).toBeDefined()
    expect(order).toEqual(["serving", `wake:${TARGET}`])
    started?.consumer.stop()
  })

  test("#given a startup pending sweep that throws after the consumer was acknowledged #when the start fails #then the consumer is stopped and its subscriptions are gone", async () => {
    const h = (harness = createGatewayHarness())
    const real = h.store()
    const broken: GatewayStore = {
      ...real,
      intakeMarks: {
        ...real.intakeMarks,
        openSessions: async () => {
          throw new Error("the intake marks could not be read")
        },
      },
    }
    const service = createFakeDeliveryService({ admitted: true })
    service.ackServe({ wake: true })
    const died: string[] = []
    await expect(
      startDeliveryConsumer({
        ...input(h, async () => service.port),
        store: broken,
        onDied: () => {
          died.push("dead")
        },
      }),
    ).rejects.toThrow("the intake marks could not be read")
    expect(died).toEqual(["dead"])
    await expect(
      service.inbound({
        command_id: "c-x",
        sender_device: "device-b",
        durable_id: "dur-anyone",
        record: { type: "admit_external_message" },
      }),
    ).rejects.toThrow("no consumer is declared")
  })

  test("#given two local sessions whose projects disagree about same_device #when the consumer starts and sweeps their rows #then only the session whose own project allows it is woken", async () => {
    const h = (harness = createGatewayHarness())
    const dirOn = mkdtempSync("/tmp/omo-wake-sweep-on-")
    const dirOff = mkdtempSync("/tmp/omo-wake-sweep-off-")
    writeSessionFile(join(h.agentDir, "sessions"), "t-on", { cwd: dirOn })
    writeSessionFile(join(h.agentDir, "sessions"), "t-off", { cwd: dirOff })
    const sender = h.session("a")
    h.phantom("t-on")
    h.phantom("t-off")
    for (const target of ["t-on", "t-off"])
      expect(await sender.engine.deliver({ sender: { kind: "session", durable_id: "a" }, target, text: "hi" })).toMatchObject(
        { kind: "ok", delivery: { kind: "queued_offline" } },
      )
    const woken: string[] = []
    const service = createFakeDeliveryService({ admitted: true })
    service.ackServe({})
    const started = await startDeliveryConsumer({
      ...input(h, async () => service.port),
      wake: async (durableId) => {
        woken.push(durableId)
      },
      sameDevice: (cwd) => cwd === dirOn,
    })
    expect(started).toBeDefined()
    expect(woken).toEqual(["t-on"])
    started?.consumer.stop()
  })
})
