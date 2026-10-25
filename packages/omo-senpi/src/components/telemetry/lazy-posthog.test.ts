import { expect, it } from "bun:test"
import { gunzipSync } from "node:zlib"
import { createConsentGatedFetch } from "@oh-my-opencode/telemetry-core/injected"
import type { TelemetryCaptureMessage, TelemetryTransport, TelemetryDiagnosticInput } from "@oh-my-opencode/telemetry-core"
import { createLazyPostHogTransportFactory } from "./lazy-posthog"

const options = {
  host: "https://posthog.test", disableGeoip: false, enableExceptionAutocapture: false,
  enableLocalEvaluation: false, strictLocalEvaluation: true, disableRemoteConfig: true,
  flushAt: 20, flushInterval: 10_000,
}
const message = (event: string): TelemetryCaptureMessage => ({ distinctId: "test", event, properties: { ordinal: event } })

function deferred<T>() {
  let resolve: (value: T) => void = () => { throw new Error("uninitialized deferred") }
  const promise = new Promise<T>((done) => { resolve = done })
  return { promise, resolve }
}

it("delivers every buffered capture in order as soon as the runtime loads", async () => {
  // Given captures waiting on an import, with no flush or shutdown to drive them.
  const load = deferred<{ createDefaultPostHogTransport: () => TelemetryTransport }>()
  const delivered = deferred<void>()
  const captured: TelemetryCaptureMessage[] = []
  const transport = createLazyPostHogTransportFactory({ load: () => load.promise })("key", options)
  transport.capture(message("first"))
  transport.capture(message("second"))
  // When the runtime becomes available, then replay happens without a lifecycle call.
  load.resolve({ createDefaultPostHogTransport: () => ({
    capture(value) {
      captured.push(value)
      if (captured.length === 2) delivered.resolve()
    },
    shutdown: async () => undefined,
  }) })
  await delivered.promise
  expect(captured).toEqual([message("first"), message("second")])
  await transport.shutdown()
})

for (const method of ["flush", "shutdown"] as const) {
  it(`buffers captures in order and awaits the sidecar before ${method}`, async () => {
    // Given a pending runtime and a recorded transport.
    const load = deferred<{ createDefaultPostHogTransport: () => TelemetryTransport }>()
    const calls: unknown[] = []
    let loads = 0
    const factory = createLazyPostHogTransportFactory({ load: () => { loads++; return load.promise } })
    const transport = factory("key", options)
    expect(loads).toBe(0)
    // When captures and a lifecycle operation arrive before import completion.
    transport.capture(message("first"))
    transport.capture(message("second"))
    let finished = false
    const pending = transport[method]?.().then(() => { finished = true })
    expect(finished).toBe(false)
    expect(calls).toEqual([])
    load.resolve({ createDefaultPostHogTransport: () => ({
      capture: (value) => { calls.push(value) },
      flush: async () => { calls.push("flush") },
      shutdown: async () => { calls.push("shutdown") },
    }) })
    await pending
    // Then the original payloads precede the lifecycle call exactly once.
    expect(loads).toBe(1)
    expect(calls).toEqual([message("first"), message("second"), method])
    transport.capture(message("third"))
    expect(calls.at(-1)).toEqual(message("third"))
  })
}

it("reports a failed import without throwing and retries after backoff", async () => {
  // Given a loader that fails once.
  const diagnostics: TelemetryDiagnosticInput[] = []
  const captured: TelemetryCaptureMessage[] = []
  let attempts = 0
  let now = 0
  const transport = createLazyPostHogTransportFactory({
    now: () => now,
    diagnostics: (value) => { diagnostics.push(value) },
    load: async () => {
      if (++attempts === 1) throw new Error("missing sidecar")
      return { createDefaultPostHogTransport: () => ({
        capture: (value: TelemetryCaptureMessage) => { captured.push(value) },
        shutdown: async () => undefined,
      }) }
    },
  })("key", options)
  // When import fails, then flush resolves and reports the existing diagnostic.
  transport.capture(message("first"))
  await transport.flush?.()
  expect(diagnostics.map(value => value.event)).toEqual(["telemetry_posthog_import_failed"])
  expect(captured).toEqual([])
  // When another call retries after the backoff, then all queued messages retain their order.
  now = 60_000
  transport.capture(message("second"))
  await transport.shutdown()
  expect(attempts).toBe(2)
  expect(captured).toEqual([message("first"), message("second")])
})

it("does not load the SDK on shutdown when no capture ever happened", async () => {
  // Given a transport that has never captured.
  let loads = 0
  const transport = createLazyPostHogTransportFactory({
    load: async () => { loads++; throw new Error("must not load") },
  })("key", options)
  // When the unused transport exits, then no runtime is imported.
  await transport.shutdown()
  expect(loads).toBe(0)
})

it("resolves shutdown and diagnoses a pending import failure, then allows retry", async () => {
  // Given a capture whose runtime fails while shutdown is awaiting it.
  const load = deferred<{ createDefaultPostHogTransport: () => TelemetryTransport }>()
  const diagnostics: TelemetryDiagnosticInput[] = []
  const calls: string[] = []
  let attempts = 0
  let now = 0
  const transport = createLazyPostHogTransportFactory({
    now: () => now,
    diagnostics: (value) => { diagnostics.push(value) },
    load: () => {
      attempts++
      return attempts === 1
        ? load.promise.then(() => { throw new Error("failed import") })
        : Promise.resolve({ createDefaultPostHogTransport: () => ({
            capture: (value) => { calls.push(value.event) },
            shutdown: async () => { calls.push("shutdown") },
          }) })
    },
  })("key", options)
  transport.capture(message("buffered"))
  // When exit waits for the failed import, then it resolves and reports, without losing the buffer.
  const shutdown = transport.shutdown()
  load.resolve({ createDefaultPostHogTransport: () => { throw new Error("unused") } })
  await shutdown
  expect(diagnostics.map(value => value.event)).toEqual(["telemetry_posthog_import_failed"])
  expect(calls).toEqual([])
  now = 60_000
  await transport.shutdown()
  expect(attempts).toBe(2)
  expect(calls).toEqual(["buffered", "shutdown"])
})

for (const consentAtLoad of [true, false]) {
  it(`preserves the real SDK's send-time consent gate when delayed load resolves with consent=${consentAtLoad}`, async () => {
    // Given an actual SDK behind a pending sidecar and a local-only endpoint.
    const ready = deferred<void>()
    const posted: unknown[] = []
    const dropped: number[] = []
    let consent = true
    const server = Bun.serve({
      hostname: "127.0.0.1", port: 0,
      async fetch(request) {
        const raw = new Uint8Array(await request.arrayBuffer())
        const body: unknown = JSON.parse(new TextDecoder().decode(
          request.headers.get("content-encoding") === "gzip" ? gunzipSync(raw) : raw,
        ))
        posted.push(body)
        return Response.json({ status: 1 })
      },
    })
    const transport = createLazyPostHogTransportFactory({
      load: async () => { await ready.promise; return import("./posthog-runtime") },
    })("test-api-key", {
      ...options, host: `http://127.0.0.1:${server.port}`, flushInterval: 0,
      fetch: createConsentGatedFetch({
        isSendAllowed: () => consent,
        onDropped: (count) => { dropped.push(count) },
      }),
    })
    try {
      transport.capture(message("first"))
      transport.capture(message("second"))
      // When consent changes before import completes and shutdown drains the real SDK.
      consent = consentAtLoad
      const shutdown = transport.shutdown()
      ready.resolve()
      await shutdown
      // Then the socket receives either the original ordered payloads or no events.
      if (consentAtLoad) {
        expect(posted).toEqual([expect.objectContaining({
          batch: [
            expect.objectContaining({ event: "first", distinct_id: "test", properties: expect.objectContaining({ ordinal: "first" }) }),
            expect.objectContaining({ event: "second", distinct_id: "test", properties: expect.objectContaining({ ordinal: "second" }) }),
          ],
        })])
        expect(dropped).toEqual([])
      } else {
        expect(posted).toEqual([])
        expect(dropped).toEqual([2])
      }
    } finally {
      await transport.shutdown()
      await server.stop(true)
    }
  })
}
