import { afterEach, describe, expect, test } from "bun:test"
import { join } from "node:path"

import { createFakeDeliveryService } from "../consumer/testing/fake-delivery-service"
import type { DeliveryConsumer } from "../consumer/consumer"
import { createGatewayHarness, type GatewayHarness } from "../gateway/testing/harness"
import type { IntakeRequest } from "../gateway/types"
import type { DeliveryServicePort } from "../consumer/port"
import { startDeliveryConsumer } from "./consumer-start"
import { writeSessionFile } from "./testing/fake-wake-host"

// The consumer start's death contract (#13456's LOW 1 carried here, #13457's LOW 1 and LOW 2): a start that fails
// closes its port and reports itself dead instead of throwing, and a connection that ends while the startup pending
// sweep runs never leaves a stale serving consumer behind.

const TARGET = "dur-target"
let harness: GatewayHarness | undefined
afterEach(async () => {
  await harness?.dispose()
  harness = undefined
})

function fakePort(options: {
  readonly serve?: () => Promise<unknown>
  readonly onPeerAdmitted?: () => void
}): { readonly port: DeliveryServicePort; readonly served: Promise<void>; readonly closed: () => boolean } {
  let resolveServed: (() => void) | undefined
  const served = new Promise<void>((resolve) => {
    resolveServed = resolve
  })
  let markClosed: () => void = () => undefined
  const closed = new Promise<void>((resolve) => {
    markClosed = resolve
  })
  let closedNow = false
  const noop = (): void => undefined
  const port: DeliveryServicePort = {
    serve: async () => {
      resolveServed?.()
      resolveServed = undefined
      return options.serve?.() ?? {}
    },
    answer: async () => undefined,
    held: async () => undefined,
    peerAdmitted: async () => {
      options.onPeerAdmitted?.()
      return true
    },
    pending: async () => undefined,
    drained: async () => ({ kept: false }),
    onInbound: () => noop,
    onHolds: () => noop,
    onWake: () => noop,
    closed,
    close: () => {
      closedNow = true
      markClosed()
    },
  }
  return { port, served, closed: () => closedNow }
}

function intake(h: GatewayHarness): IntakeRequest {
  return {
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
    const fake = fakePort({
      serve: () => {
        throw new Error("forbidden")
      },
    })
    const serving = await startDeliveryConsumer({
      ...input(h, async () => fake.port),
      onDied: () => {
        died.push("dead")
      },
    })
    expect(serving).toBeUndefined()
    expect(fake.closed()).toBe(true)
    expect(died).toEqual(["dead"])
  })

  test("#given the serving connection ends while the startup pending sweep runs #when the consumer finishes starting #then no stale serving consumer is returned", async () => {
    const h = (harness = createGatewayHarness())
    writeSessionFile(join(h.agentDir, "sessions"), TARGET, { cwd: process.cwd() })
    expect((await h.store().intake(intake(h))).kind).toBe("queued")
    // The sweep's admission check is where the service restart lands: the connection ends under the sweep's feet.
    const fake = fakePort({
      onPeerAdmitted: () => {
        fake.port.close?.()
      },
    })
    const serving = await startDeliveryConsumer(input(h, async () => fake.port))
    expect(serving).toBeUndefined()
  })

  test("#given a session whose queued row waits from another device #when the consumer starts and its pending sweep wakes it #then the consumer already reads serving at the wake", async () => {
    const h = (harness = createGatewayHarness())
    const store = h.store()
    writeSessionFile(join(h.agentDir, "sessions"), TARGET, { cwd: process.cwd() })
    expect((await store.intake(intake(h))).kind).toBe("queued")
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
})
