import { expect, it } from "bun:test"
import type { TelemetryCaptureMessage, TelemetryDiagnosticInput } from "@oh-my-opencode/telemetry-core"
import { createEventTelemetryClient, recordDailyActive } from "@oh-my-opencode/telemetry-core/injected"
import { createLazyPostHogTransportFactory } from "./lazy-posthog"
import { createSenpiTelemetryProductConfig } from "./index"

const options = {
  host: "https://posthog.test", disableGeoip: false, enableExceptionAutocapture: false,
  enableLocalEvaluation: false, strictLocalEvaluation: true, disableRemoteConfig: true,
  flushAt: 20, flushInterval: 0,
}
const message = (ordinal: number): TelemetryCaptureMessage => ({
  distinctId: "synthetic", event: "buffered", properties: { ordinal },
})

it("keeps the caller's diagnostic source when the sidecar import fails", async () => {
  // Given a named caller and an unavailable runtime, when capture triggers an import, then its diagnostic keeps that source.
  const diagnostics: TelemetryDiagnosticInput[] = []
  const transport = createLazyPostHogTransportFactory({
    source: "native-caller",
    diagnostics: value => { diagnostics.push(value) },
    load: async () => { throw new Error("unavailable") },
  })("key", options)
  transport.capture(message(0))
  await transport.flush?.()
  expect(diagnostics).toHaveLength(1)
  expect(diagnostics[0]?.source).toBe("native-caller")
})

it("bounds the buffer at 256 captures, drops oldest, and reports the aggregate once on flush", async () => {
  // Given an import held open while the fixed buffer overflows.
  let release: () => void = () => { throw new Error("uninitialized") }
  const ready = new Promise<void>(resolve => { release = resolve })
  const captured: TelemetryCaptureMessage[] = []
  const diagnostics: TelemetryDiagnosticInput[] = []
  const transport = createLazyPostHogTransportFactory({
    source: "buffer-test",
    diagnostics: value => { diagnostics.push(value) },
    load: async () => {
      await ready
      return { createDefaultPostHogTransport: () => ({
        capture: (value: TelemetryCaptureMessage) => { captured.push(value) },
        shutdown: async () => undefined,
      }) }
    },
  })("key", options)
  for (let ordinal = 0; ordinal < 260; ordinal++) transport.capture(message(ordinal))
  expect(diagnostics).toEqual([])
  // When flush drains the pending runtime, then the newest 256 retain order.
  const flushed = transport.flush?.()
  release()
  await flushed
  await transport.flush?.()
  expect(captured).toEqual(Array.from({ length: 256 }, (_, i) => message(i + 4)))
  expect(diagnostics.map(({ event, count, source }) => ({ event, count, source }))).toEqual([
    { event: "telemetry_buffer_overflow", count: 4, source: "buffer-test" },
  ])
  await transport.shutdown()
})

it("memoizes one import across transports and backs off failures without retrying per capture", async () => {
  // Given a failed sidecar and a deterministic clock.
  let now = 0
  let imports = 0
  const diagnostics: TelemetryDiagnosticInput[] = []
  const captured: TelemetryCaptureMessage[] = []
  const factory = createLazyPostHogTransportFactory({
    source: "caller-source", now: () => now,
    diagnostics: value => { diagnostics.push(value) },
    load: async () => {
      if (++imports === 1) throw new Error("sidecar unavailable")
      return { createDefaultPostHogTransport: () => ({
        capture: (value: TelemetryCaptureMessage) => { captured.push(value) },
        shutdown: async () => undefined,
      }) }
    },
  })
  const first = factory("key", options)
  first.capture(message(1))
  await first.flush?.()
  const second = factory("key", options)
  // When many captures and exits arrive during the backoff, then none re-import.
  for (let i = 2; i < 5; i++) {
    first.capture(message(i))
    second.capture(message(i + 10))
    await Promise.all([first.flush?.(), second.shutdown()])
  }
  expect(imports).toBe(1)
  expect(diagnostics).toHaveLength(1)
  expect(diagnostics[0]).toMatchObject({ event: "telemetry_posthog_import_failed", source: "caller-source" })
  // When the backoff expires, both transports share the one successful retry.
  now = 60_000
  await Promise.all([first.flush?.(), second.flush?.()])
  expect(imports).toBe(2)
  expect(captured).toHaveLength(7)
  await Promise.all([first.shutdown(), second.shutdown()])
})

for (const method of ["flush", "shutdown"] as const) {
  it(`does not import an unused SDK on ${method}`, async () => {
    // Given no buffered event, when the lifecycle operation runs, then the loader stays untouched.
    let imports = 0
    const transport = createLazyPostHogTransportFactory({
      load: async () => { imports++; throw new Error("must not import") },
    })("key", options)
    await transport[method]?.()
    expect(imports).toBe(0)
  })
}

it("never calls the loader for disabled native or legacy telemetry", async () => {
  // Given disabled telemetry and a load spy used by both real core clients.
  let imports = 0
  const transportFactory = createLazyPostHogTransportFactory({
    load: async () => { imports++; throw new Error("must not import") },
  })
  const product = createSenpiTelemetryProductConfig()
  const env = { DO_NOT_TRACK: "1" }
  // When disabled clients are used, then capture, flush and shutdown cannot reach the loader.
  const client = createEventTelemetryClient({
    distinctId: "synthetic", env, product, source: "disabled",
    propertyAllowlist: { test: [] }, schemaVersion: 1, transportFactory,
  })
  client.captureEvent("test", {})
  await client.flush()
  await client.shutdown()
  await recordDailyActive({
    env, product, reason: "test", source: "disabled", stateDir: "/never-used",
    transportFactory,
  })
  expect(client.enabled).toBe(false)
  expect(imports).toBe(0)
})
