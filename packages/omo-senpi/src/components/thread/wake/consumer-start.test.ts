import { afterEach, describe, expect, test } from "bun:test"
import { mkdtempSync, rmSync } from "node:fs"
import { join } from "node:path"

import { createFakeDeliveryService } from "../consumer/testing/fake-delivery-service"
import { createGatewayHarness, type GatewayHarness } from "../gateway/testing/harness"
import type { IntakeRequest } from "../gateway/types"
import type { GatewayStore } from "../gateway/store"
import { startDeliveryConsumer } from "./consumer-start"
import { writeSessionFile } from "./testing/fake-wake-host"

// #13456's LOW 1: the consumer is acknowledged as serving BEFORE its startup pending sweep runs, so a remote row that
// sweep wakes cannot read the carrier's gate as off. And #13455's LOW with #13456's LOW 3, one root: that sweep reads
// `session_wake.same_device` for each swept session's OWN cwd (its project's configuration), never the caller's
// workspace root.

const TARGET = "dur-target"
let harness: GatewayHarness | undefined
const tempDirs: string[] = []
afterEach(async () => {
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true })
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
    const order: string[] = []
    await expect(
      startDeliveryConsumer({
        store: broken,
        agentDir: h.agentDir,
        sessionsDirectory: join(h.agentDir, "sessions"),
        deliveries: async () => service.port,
        engineVersion: "2026.12.1",
        minimumEngine: "2026.12.1",
        wake: async () => undefined,
        sameDevice: () => false,
        onServing: () => {
          order.push("serving")
        },
        log: () => undefined,
      }),
    ).rejects.toThrow("the intake marks could not be read")
    expect(order).toEqual(["serving"])
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
    const store = h.store()
    const dirOn = mkdtempSync("/tmp/omo-wake-sweep-on-")
    const dirOff = mkdtempSync("/tmp/omo-wake-sweep-off-")
    tempDirs.push(dirOn, dirOff)
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
