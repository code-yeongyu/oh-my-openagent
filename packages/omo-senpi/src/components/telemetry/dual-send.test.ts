import { expect, test } from "bun:test"
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
  let resolve!: (value: TelemetryTransport) => void
  const ready = new Promise<TelemetryTransport>(done => { resolve = done })
  let loads = 0
  const transport = createLazyPostHogTransportFactory({
    load: async () => ({ createDefaultPostHogTransport: () => recorder(posthog) }),
    loadOtlp: () => { loads++; return ready },
  })("key", options)
  expect(loads).toBe(0)
  transport.capture(message)
  const flushed = transport.flush?.()
  resolve(recorder(otlp))
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
  let resolve!: (value: TelemetryTransport) => void
  const ready = new Promise<TelemetryTransport>(done => { resolve = done })
  const transport = createLazyPostHogTransportFactory({
    load: async () => ({ createDefaultPostHogTransport: () => recorder([]) }),
    loadOtlp: () => ready,
    consent: () => consent,
  })("key", options)
  transport.capture(message)
  consent = false
  const shutdown = transport.shutdown()
  resolve(recorder(otlp))
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
