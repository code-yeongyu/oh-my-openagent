import { afterEach, describe, expect, test } from "bun:test"
import { mkdtempSync } from "node:fs"
import { join } from "node:path"

import { createFakeDeliveryService } from "../consumer/testing/fake-delivery-service"
import { startThreadWakeAtSession, wakeHostIdleExitMs, type ThreadWakeLatch, type ThreadWakeOptions } from "./runtime"

// A carrier that carries nothing arms no sweep timer (design A3.1.4; #13455's MEDIUM and its delta review), the
// delivery consumer beside it is started again after it dies (#13457's MEDIUM), and the ensured host's idle-exit
// setting is read with a warning when the configuration cannot be (#13456's delta review).

const latches: ThreadWakeLatch[] = []
afterEach(() => {
  latches.splice(0)
})

function start(
  agentDir: string,
  options: Partial<ThreadWakeOptions>,
  warn: (line: string) => void = () => undefined,
) {
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
    warn,
  })
  return latch.running?.get(agentDir)
}

describe("a running wake over an empty wake table", () => {
  test("#given an engine at the wake minimum and an empty wake table #when the wake starts #then no sweep timer is armed", async () => {
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
    await running?.stop()
  })
})

describe("the ensured host's idle-exit setting", () => {
  test("#given a configuration the loader cannot read #when the idle exit is asked for #then the failure is warned once per read and the spec's default runs", async () => {
    let broken = true
    const warnings: string[] = []
    const read = wakeHostIdleExitMs(
      {
        loadConfig: () => {
          if (broken) throw new Error("the configuration is broken")
          return { config: { task: { host_idle_exit_ms: 120_000 } } }
        },
      },
      () => process.cwd(),
      (line) => {
        warnings.push(line)
      },
    )
    expect(read()).toBeUndefined()
    expect(warnings).toHaveLength(1)
    broken = false
    expect(read()).toBe(120_000)
    expect(warnings).toHaveLength(1)
  })
})

describe("the consumer retry loop's warnings", () => {
  test("#given a service that stays refused across retries #when three attempts fail and the service then recovers and fails again #then exactly one warning is written per stretch of failure", async () => {
    const agentDir = mkdtempSync("/tmp/omo-wake-runtime-")
    const warnings: string[] = []
    let healthy = false
    const bad = createFakeDeliveryService({ admitted: true })
    bad.refuseServe("forbidden")
    const good = createFakeDeliveryService({ admitted: true })
    good.ackServe({ wake: true })
    let serves = 0
    const servedHooks: ((count: number) => void)[] = []
    const servedAt = (n: number): Promise<void> =>
      new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error(`waited 5s for serve #${n}`)), 5_000)
        timer.unref?.()
        servedHooks.push((count) => {
          if (count !== n) return
          clearTimeout(timer)
          resolve()
        })
      })
    const wrap = (port: ReturnType<typeof createFakeDeliveryService>["port"]) => ({
      ...port,
      serve: async (request: { readonly agent_dir: string; readonly v: number }) => {
        try {
          return await port.serve(request)
        } finally {
          serves += 1
          for (const hook of [...servedHooks]) hook(serves)
        }
      },
    })
    const timers: (() => void)[] = []
    let warn2: () => void = () => undefined
    const secondWarning = new Promise<void>((resolve, reject) => {
      warn2 = resolve
      const timer = setTimeout(() => reject(new Error("waited 5s for the second stretch's warning")), 5_000)
      timer.unref?.()
      const original = warn2
      warn2 = () => {
        clearTimeout(timer)
        original()
      }
    })
    const running = start(
      agentDir,
      {
        deliveries: async () => (healthy ? wrap(good.port) : wrap(bad.port)),
        schedule: (run) => {
          timers.push(run)
          return () => undefined
        },
      },
      (line) => {
        warnings.push(line)
        if (warnings.length === 2) warn2()
      },
    )
    await running?.ready
    expect(warnings).toHaveLength(1)
    for (const serve of [2, 3]) {
      const next = servedAt(serve)
      timers.at(-1)?.()
      await next
      expect(warnings).toHaveLength(1)
    }
    healthy = true
    const recovered = servedAt(4)
    timers.at(-1)?.()
    await recovered
    expect(await running?.admitIntake("device-b")).toBe("admitted")
    expect(warnings).toHaveLength(1)
    healthy = false
    good.drop()
    await good.port.closed
    timers.at(-1)?.()
    await secondWarning
    expect(warnings).toHaveLength(2)
    await running?.stop()
  })
})

describe("the consumer's stop against an in-flight retry", () => {
  test("#given a retry whose port has not answered yet #when stop() runs before it settles #then the consumer that retry produces is closed, not left open", async () => {
    const agentDir = mkdtempSync("/tmp/omo-wake-runtime-")
    const service = createFakeDeliveryService({ admitted: true })
    service.ackServe({ wake: true })
    const timers: (() => void)[] = []
    let calls = 0
    let releasePort: () => void = () => undefined
    const running = start(agentDir, {
      deliveries: async () => {
        calls += 1
        if (calls === 2) await new Promise<void>((resolve) => {
          releasePort = resolve
        })
        return service.port
      },
      schedule: (run) => {
        timers.push(run)
        return () => undefined
      },
    })
    await running?.ready
    service.drop()
    await service.port.closed
    timers.at(-1)?.()
    const stopped = running?.stop()
    releasePort()
    await stopped
    expect(await (service.port.closed ?? Promise.resolve()).then(() => true)).toBe(true)
    await expect(
      service.inbound({
        command_id: "c-x",
        sender_device: "device-b",
        durable_id: "dur-anyone",
        record: { type: "admit_external_message" },
      }),
    ).rejects.toThrow("no consumer is declared")
  })
})

describe("the consumer's connect-failure and rejected-start deaths", () => {
  test("#given a device service state directory nothing answers #when the wake starts on the production port #then the failure is warned once and a retry is armed through the runtime", async () => {
    const agentDir = mkdtempSync("/tmp/omo-wake-runtime-")
    const stateDir = mkdtempSync("/tmp/omo-wake-no-service-")
    const warnings: string[] = []
    const timers: (() => void)[] = []
    const running = start(
      agentDir,
      {
        deviceServiceStateDir: stateDir,
        schedule: (run) => {
          timers.push(run)
          return () => undefined
        },
      },
      (line) => {
        warnings.push(line)
      },
    )
    await running?.ready
    expect(warnings).toHaveLength(1)
    expect(warnings[0]).toContain("answered no delivery connection")
    expect(timers).toHaveLength(1)
    await running?.stop()
  })

  test("#given a deliveries seam that rejects #when the start fails and the retry fires #then the consumer is started again and serves", async () => {
    const agentDir = mkdtempSync("/tmp/omo-wake-runtime-")
    const service = createFakeDeliveryService({ admitted: true })
    service.ackServe({ wake: true })
    let broken = true
    let served = 0
    let firstServe: () => void = () => undefined
    const first = new Promise<void>((resolve, reject) => {
      firstServe = resolve
      setTimeout(() => reject(new Error("waited 5s for the consumer to serve after the rejected start")), 5_000).unref?.()
    })
    const timers: (() => void)[] = []
    const running = start(agentDir, {
      deliveries: async () => {
        if (broken) {
          broken = false
          throw new Error("the seam is broken")
        }
        return {
          ...service.port,
          serve: async (request: { readonly agent_dir: string; readonly v: number }) => {
            const reply = await service.port.serve(request)
            served += 1
            if (served === 1) firstServe()
            return reply
          },
        }
      },
      schedule: (run) => {
        timers.push(run)
        return () => undefined
      },
    })
    await running?.ready
    expect(service.calls.filter((call) => call.type === "deliveries.serve")).toHaveLength(0)
    expect(timers).toHaveLength(1)
    timers.at(-1)?.()
    await first
    expect(service.calls.filter((call) => call.type === "deliveries.serve")).toHaveLength(1)
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
    let secondServe: () => void = () => undefined
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
    let secondServe: () => void = () => undefined
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
