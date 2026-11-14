import { afterEach, describe, expect, test } from "bun:test"
import { existsSync, mkdtempSync } from "node:fs"
import { join } from "node:path"

import { gatewayDatabasePath } from "../gateway/paths"
import { createFakeDeliveryService } from "../consumer/testing/fake-delivery-service"
import { startThreadWakeAtSession, type ThreadWakeLatch, type ThreadWakeOptions } from "./runtime"

// A carrier that carries nothing arms no sweep timer and opens no store of its own (design A3.1.4; #13455's MEDIUM),
// and the delivery consumer beside it is started again after it dies (#13457's MEDIUM), so a device service that
// comes up or restarts after the engine keeps its remote wake.

const latches: ThreadWakeLatch[] = []
afterEach(() => {
  latches.splice(0)
})

function start(agentDir: string, options: Partial<ThreadWakeOptions>) {
  const latch: ThreadWakeLatch = {}
  latches.push(latch)
  startThreadWakeAtSession({ mode: "tui" }, {
    options: {
      env: { HOME: agentDir },
      latch,
      engineVersion: "2026.12.1",
      minimumEngine: "2026.12.1",
      connect: () => Promise.reject(new Error("no carrier may open a session")),
      ...options,
    },
    agentDir: () => agentDir,
    sessionsDirectory: () => join(agentDir, "sessions"),
    settings: () => ({ sameDevice: true, wakeLimit: 0 }),
    engineVersion: "2026.12.1",
    ensureHost: undefined,
    warn: () => undefined,
  })
  return latch.running?.get(agentDir)
}

describe("a running wake over an empty wake table", () => {
  test("#given an engine at the wake minimum and no store handed to it #when the wake starts #then no store is opened and no timer is armed", async () => {
    const agentDir = mkdtempSync("/tmp/omo-wake-runtime-")
    const scheduled: number[] = []
    const running = start(agentDir, {
      deliveries: async () => undefined,
      schedule: (_run, ms) => {
        scheduled.push(ms)
        return () => undefined
      },
    })
    expect(running).toBeDefined()
    await running?.ready
    expect(scheduled).toEqual([])
    expect(existsSync(gatewayDatabasePath(agentDir))).toBe(false)
    await running?.stop()
  })
})

describe("a delivery consumer that dies", () => {
  test("#given a serving consumer whose connection the service drops #when the retry interval fires #then the consumer declares itself again on a new connection", async () => {
    const agentDir = mkdtempSync("/tmp/omo-wake-runtime-")
    const service = createFakeDeliveryService({ admitted: true })
    service.ackServe({ wake: true })
    const timers: (() => void)[] = []
    let served = 0
    let secondServe: (() => void) = () => undefined
    const second = new Promise<void>((resolve, reject) => {
      secondServe = resolve
      setTimeout(() => reject(new Error("waited 5s for the consumer to declare itself again")), 5_000).unref?.()
    })
    const running = start(agentDir, {
      deliveries: async () => ({
        ...service.port,
        serve: async (request) => {
          const reply = await service.port.serve(request)
          served += 1
          if (served === 2) secondServe()
          return reply
        },
      }),
      schedule: (run) => {
        timers.push(run)
        return () => undefined
      },
    })
    await running?.ready
    expect(served).toBe(1)
    const armed = timers.length
    service.drop()
    await service.port.closed
    expect(timers.length).toBe(armed + 1)
    timers.at(-1)?.()
    await second
    expect(
      service.calls.filter((call) => call.type === "deliveries.serve"),
    ).toHaveLength(2)
    await running?.stop()
  })

  test("#given a service that refuses the declaration #when the retry interval fires #then the consumer tries again", async () => {
    const agentDir = mkdtempSync("/tmp/omo-wake-runtime-")
    const service = createFakeDeliveryService({ admitted: true })
    service.refuseServe("forbidden")
    const timers: (() => void)[] = []
    let served = 0
    let secondServe: (() => void) = () => undefined
    const second = new Promise<void>((resolve, reject) => {
      secondServe = resolve
      setTimeout(() => reject(new Error("waited 5s for the consumer to declare itself after the refusal")), 5_000).unref?.()
    })
    const running = start(agentDir, {
      deliveries: async () => ({
        ...service.port,
        serve: async (request) => {
          try {
            return await service.port.serve(request)
          } finally {
            served += 1
            if (served === 2) secondServe()
          }
        },
      }),
      schedule: (run) => {
        timers.push(run)
        return () => undefined
      },
    })
    await running?.ready
    expect(service.calls.filter((call) => call.type === "deliveries.serve")).toHaveLength(1)
    timers.at(-1)?.()
    await second
    expect(service.calls.filter((call) => call.type === "deliveries.serve")).toHaveLength(2)
    await running?.stop()
  })
})
