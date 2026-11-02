import { expect, spyOn, test } from "bun:test"
import type { TelemetryCaptureMessage, TelemetryTransport, TelemetryTransportOptions } from "@oh-my-opencode/telemetry-core"
import { createLazyPostHogTransportFactory } from "./lazy-posthog"

const options: TelemetryTransportOptions = {
  host: "https://posthog.test", disableGeoip: false, enableExceptionAutocapture: false,
  enableLocalEvaluation: false, strictLocalEvaluation: true, disableRemoteConfig: true,
  flushAt: 20, flushInterval: 10_000,
}
const message: TelemetryCaptureMessage = { distinctId: "test", event: "daily_active", properties: { day_utc: "2026-10-26" } }

function recorder(calls: unknown[]): TelemetryTransport {
  return {
    capture: value => { calls.push(value) },
    captureImmediate: async value => { calls.push(value) },
    flush: async () => { calls.push("flush") },
    shutdown: async () => { calls.push("shutdown") },
  }
}

test("dual-send lazily fans out buffered captures and awaits both lifecycle operations", async () => {
  const posthog: unknown[] = []
  const otlp: unknown[] = []
  const ready = Promise.withResolvers<TelemetryTransport>()
  let loads = 0
  const transport = createLazyPostHogTransportFactory({
    load: async () => ({ createDefaultPostHogTransport: () => recorder(posthog) }),
    loadOtlp: () => { loads++; return ready.promise },
  })("key", options)
  expect(loads).toBe(0)
  transport.capture(message)
  const flushed = transport.flush?.()
  ready.resolve(recorder(otlp))
  await flushed
  expect(posthog).toEqual([message, "flush"])
  expect(otlp).toEqual([message, "flush"])
  expect(loads).toBe(1)
  await transport.shutdown()
  expect(posthog.at(-1)).toBe("shutdown")
  expect(otlp.at(-1)).toBe("shutdown")
})

for (const failure of ["reject", "null", "timeout"] as const) {
  test(`dual-send preserves PostHog when OTLP initialization returns ${failure}`, async () => {
    const posthog: unknown[] = []
    const transport = createLazyPostHogTransportFactory({
      load: async () => ({ createDefaultPostHogTransport: () => recorder(posthog) }),
      loadOtlp: () => failure === "reject" ? Promise.reject(new Error("OTLP unavailable"))
        : failure === "null" ? Promise.resolve(null) : new Promise(() => undefined),
      timeoutMs: 10,
    })("key", options)
    transport.capture(message)
    await transport.shutdown()
    expect(posthog).toEqual([message, "shutdown"])
  })
}

test("dual-send preserves OTLP when PostHog initialization fails", async () => {
  const otlp: unknown[] = []
  const transport = createLazyPostHogTransportFactory({
    load: async () => { throw new Error("PostHog unavailable") },
    loadOtlp: async () => recorder(otlp),
  })("key", options)
  transport.capture(message)
  await transport.shutdown()
  expect(otlp).toEqual([message, "shutdown"])
})

test("dual-send forwards immediate events to OTLP even when the PostHog acknowledgement fails", async () => {
  const otlp: unknown[] = []
  const transport = createLazyPostHogTransportFactory({
    load: async () => ({ createDefaultPostHogTransport: () => ({
      capture: () => undefined,
      captureImmediate: async () => { throw new Error("PostHog rejected") },
      shutdown: async () => undefined,
    }) }),
    loadOtlp: async () => recorder(otlp),
  })("key", options)
  await expect(transport.captureImmediate?.(message)).rejects.toThrow("PostHog rejected")
  await transport.shutdown()
  expect(otlp).toEqual([message, "shutdown"])
})

test("dual-send drops buffered OTLP events when consent is withdrawn before creation finishes", async () => {
  const otlp: unknown[] = []
  let consent = true
  const ready = Promise.withResolvers<TelemetryTransport>()
  const transport = createLazyPostHogTransportFactory({
    load: async () => ({ createDefaultPostHogTransport: () => recorder([]) }),
    loadOtlp: () => ready.promise,
    consent: () => consent,
  })("key", options)
  transport.capture(message)
  consent = false
  const shutdown = transport.shutdown()
  ready.resolve(recorder(otlp))
  await shutdown
  expect(otlp).toEqual(["shutdown"])
})

test("dual-send isolates capture failures and bounds a stuck OTLP shutdown", async () => {
  const posthog: unknown[] = []
  const transport = createLazyPostHogTransportFactory({
    load: async () => ({ createDefaultPostHogTransport: () => recorder(posthog) }),
    loadOtlp: async () => ({
      capture: () => { throw new Error("OTLP capture failed") },
      shutdown: () => new Promise(() => undefined),
    }),
    timeoutMs: 10,
  })("key", options)
  transport.capture(message)
  await transport.shutdown()
  expect(posthog).toEqual([message, "shutdown"])
})

test("dual-send keeps consent drains failed when PostHog flush rejects, without losing OTLP", async () => {
  const otlp: unknown[] = []
  const transport = createLazyPostHogTransportFactory({
    load: async () => ({ createDefaultPostHogTransport: () => ({
      capture: () => undefined,
      flush: async () => { throw new Error("PostHog did not drain") },
      shutdown: async () => undefined,
    }) }),
    loadOtlp: async () => recorder(otlp),
  })("key", options)
  transport.capture(message)
  await expect(transport.flush?.()).rejects.toThrow("PostHog did not drain")
  expect(otlp).toEqual([message, "flush"])
  await transport.shutdown()
})

test("dual-send does not initialize either unused transport on exit", async () => {
  let loads = 0
  const transport = createLazyPostHogTransportFactory({
    load: async () => { loads++; throw new Error("unused PostHog") },
    loadOtlp: async () => { loads++; throw new Error("unused OTLP") },
  })("key", options)
  await transport.shutdown()
  expect(loads).toBe(0)
})

for (const failure of ["reject", "timeout"] as const) {
  test(`dual-send retries OTLP ${failure} after a 60 second backoff`, async () => {
    let now = 0
    let loads = 0
    const otlp: unknown[] = []
    const late = Promise.withResolvers<TelemetryTransport>()
    const transport = createLazyPostHogTransportFactory({
      load: async () => ({ createDefaultPostHogTransport: () => recorder([]) }),
      loadOtlp: async () => {
        loads++
        if (loads > 1) return recorder(otlp)
        if (failure === "reject") throw new Error("transient startup failure")
        return late.promise
      },
      now: () => now,
      timeoutMs: 10,
    })("key", options)
    try {
      transport.capture(message)
      await transport.flush?.()
      expect(loads).toBe(1)
      now = 59_999
      transport.capture(message)
      await transport.flush?.()
      expect(loads).toBe(1)
      now = 60_000
      transport.capture(message)
      await transport.flush?.()
      expect(loads).toBe(2)
      expect(otlp).toEqual([message, "flush"])
      // A timed-out attempt must not replace the successful retry or leak a late sender.
      const disposed = Promise.withResolvers<undefined>()
      const stale: unknown[] = []
      late.resolve({ capture: value => { stale.push(value) }, shutdown: async () => { disposed.resolve(undefined) } })
      if (failure === "timeout") await disposed.promise
      expect(stale).toEqual([])
    } finally {
      await transport.shutdown()
    }
  })
}

test("dual-send refuses OTLP once after a null load and never loads for unmapped events", async () => {
  let now = 0
  let loads = 0
  const transport = createLazyPostHogTransportFactory({
    load: async () => ({ createDefaultPostHogTransport: () => recorder([]) }),
    loadOtlp: async () => { loads++; return null },
    isOtlpEvent: event => event === message.event,
    now: () => now,
  })("key", options)
  transport.capture({ ...message, event: "omo_senpi_daily_active" })
  await transport.flush?.()
  expect(loads).toBe(0)
  transport.capture(message)
  await transport.flush?.()
  expect(loads).toBe(1)
  now = 3_600_000
  transport.capture(message)
  await transport.flush?.()
  expect(loads).toBe(1)
  await transport.shutdown()
})

for (const method of ["flush", "captureImmediate"] as const) {
  test(`dual-send preserves a slow PostHog ${method} acknowledgement past OTLP bounds`, async () => {
    const started = Promise.withResolvers<undefined>()
    const acknowledged = Promise.withResolvers<undefined>()
    let slow = false
    const operation = async (): Promise<void> => {
      if (!slow) return
      started.resolve(undefined)
      await acknowledged.promise
    }
    const transport = createLazyPostHogTransportFactory({
      load: async () => ({ createDefaultPostHogTransport: () => ({
        capture: () => undefined, flush: operation, captureImmediate: operation, shutdown: async () => undefined,
      }) }),
      loadOtlp: async () => recorder([]),
    })("key", options)
    transport.capture(message)
    await transport.flush?.()
    // Drive deadlines directly, so the acknowledgement contract does not depend on wall-clock luck.
    const deadlines: (() => void)[] = []
    const schedule = globalThis.setTimeout
    const timers = spyOn(globalThis, "setTimeout").mockImplementation(Object.assign(
      <Args extends unknown[]>(callback: (...args: Args) => void, _ms?: number, ...args: Args) => {
        deadlines.push(() => callback(...args))
        return schedule(() => undefined, 60_000)
      },
      { __promisify__: schedule.__promisify__ },
    ))
    try {
      slow = true
      const pending = method === "flush" ? transport.flush?.() : transport.captureImmediate?.(message)
      // Attach a rejection handler before firing the deadlines.
      const result = Promise.resolve(pending).then(() => "acknowledged", error => String(error))
      await started.promise
      for (const deadline of deadlines) deadline()
      acknowledged.resolve(undefined)
      expect(await result).toBe("acknowledged")
    } finally {
      timers.mockRestore()
      acknowledged.resolve(undefined)
      await transport.shutdown()
    }
  })
}
