import { afterEach, describe, expect, test } from "bun:test"
import { mkdtempSync } from "node:fs"
import { join } from "node:path"

import { createFakeDeliveryService } from "../consumer/testing/fake-delivery-service"
import { createGatewayHarness, type GatewayHarness } from "../gateway/testing/harness"
import { startDeliveryConsumer } from "./consumer-start"
import { writeSessionFile } from "./testing/fake-wake-host"

// #13455's LOW and #13456's LOW 3, one root: the consumer's startup pending sweep reads `session_wake.same_device` for
// each swept session's OWN cwd (its project's configuration), never the first registering session's workspace root.

let harness: GatewayHarness | undefined
afterEach(async () => {
  await harness?.dispose()
  harness = undefined
})

describe("startDeliveryConsumer's startup pending sweep", () => {
  test("#given two local sessions whose projects disagree about same_device #when the consumer starts and sweeps their rows #then only the session whose own project allows it is woken", async () => {
    const h = (harness = createGatewayHarness())
    const store = h.store()
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
      store,
      agentDir: h.agentDir,
      sessionsDirectory: join(h.agentDir, "sessions"),
      deliveries: async () => service.port,
      engineVersion: "2026.12.1",
      minimumEngine: "2026.12.1",
      wake: async (durableId) => {
        woken.push(durableId)
      },
      sameDevice: (cwd) => cwd === dirOn,
      log: () => undefined,
    })
    expect(started).toBeDefined()
    expect(woken).toEqual(["t-on"])
    started?.consumer.stop()
  })
})
