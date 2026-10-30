import { afterEach, describe, expect, test } from "bun:test"
import { existsSync } from "node:fs"
import { dirname } from "node:path"

import { create, toBinary } from "@bufbuild/protobuf"

import { createOtlpTelemetryTransport } from "./otlp-entry"
import { ExportLogsServiceResponseSchema } from "./otlp-proto/opentelemetry/proto/collector/logs/v1/logs_service_pb.js"
import {
  attributeMap,
  capture,
  createSpoolRoot,
  decodeLogs,
  logRecordsOf,
  makeTransport,
  recordingFetch,
  spoolNames,
  TEST_SCOPE,
  testResource, testWireProjection, TEST_SPANS } from "./otlp-test-support"
import type { TelemetryDiagnosticInput } from "./types"

const roots: (() => void)[] = []
afterEach(() => {
  for (const cleanup of roots.splice(0)) cleanup()
})

function root(): string {
  const created = createSpoolRoot("telemetry-core-sender-")
  roots.push(created.cleanup)
  return created.dir
}

describe("OTLP sender", () => {
  test("#given 45 events #then batches of 20 are sealed and sent in emit order, one file per request, and the rest waits for flush", async () => {
    // given
    const dir = root()
    const { calls, fetch } = recordingFetch()
    const sealedAt = Date.now()
    const transport = makeTransport(dir, { fetch, nowMs: () => sealedAt })

    // when
    for (let index = 0; index < 45; index += 1) capture(transport, "feature_used", { seq: index })
    await transport.ready
    await transport.flush()

    // then
    const batches = calls.map((call) => logRecordsOf(decodeLogs(call.body)).map((r) => attributeMap(r.attributes)["omo.seq"]))
    expect(batches.map((batch) => batch.length)).toEqual([20, 20, 5])
    expect(batches.flat()).toEqual(Array.from({ length: 45 }, (_, index) => index))
    expect(calls.every((call) => call.url === "https://collector.test/v1/logs")).toBe(true)
    expect(calls[0]?.headers["x-omo-ingest-key"]).toBe("test-ingest-key")
    expect(calls[0]?.headers["content-type"]).toBe("application/x-protobuf")
    expect(spoolNames(dir)).toEqual([])
  }, 30_000)

  test("#given a body over 8 KB #then it is gzip-encoded; a small body is not", async () => {
    // given
    const dir = root()
    const { calls, fetch } = recordingFetch()
    const transport = makeTransport(dir, { fetch })

    // when
    capture(transport, "feature_used", { feature: "small" })
    await transport.flush()
    for (let index = 0; index < 19; index += 1) capture(transport, "feature_used", { blob: "x".repeat(64), more: "y".repeat(64), seq: index, a: "z".repeat(64), b: "w".repeat(64) })
    await transport.flush()

    // then
    expect(calls[0]?.headers["content-encoding"]).toBeUndefined()
    expect(calls[1]?.headers["content-encoding"]).toBe("gzip")
    expect(calls[1]?.body.byteLength).toBeGreaterThan(8 * 1024)
    expect(logRecordsOf(decodeLogs(calls[1]?.body ?? new Uint8Array())).length).toBe(19)
  }, 30_000)

  test("#given OTEL_EXPORTER_OTLP_ENDPOINT points elsewhere #then it is ignored; OMO_TELEMETRY_ENDPOINT overrides the configured endpoint", async () => {
    // given
    const dir = root()

    // when
    const ignored = makeTransport(dir, { env: { OTEL_EXPORTER_OTLP_ENDPOINT: "http://evil.test", OTEL_EXPORTER_OTLP_LOGS_ENDPOINT: "http://evil.test" } })
    const overridden = makeTransport(dir, { env: { OMO_TELEMETRY_ENDPOINT: "https://staging.test/" } })
    const defaulted = await createOtlpTelemetryTransport({ productEnvPrefix: "OMO_TEST", ingestKey: "k", spoolDir: dir, spoolRoot: dirname(dir), resource: testResource(), scope: TEST_SCOPE, project: testWireProjection, spans: TEST_SPANS, env: {}, autoStart: false })

    // then
    expect(ignored.endpoint).toBe("https://collector.test")
    expect(overridden.endpoint).toBe("https://staging.test")
    expect(defaulted?.endpoint).toBe("https://t.omo.dev")
  })

  test("#given OTEL_SDK_DISABLED=true or DO_NOT_TRACK=1 #then no transport is built and no spool directory exists", async () => {
    // given
    const dir = root()
    const base = { productEnvPrefix: "OMO_TEST", ingestKey: "k", spoolDir: dir, spoolRoot: dirname(dir), resource: testResource(), scope: TEST_SCOPE, project: testWireProjection, spans: TEST_SPANS, autoStart: false }

    // when
    const otelDisabled = await createOtlpTelemetryTransport({ ...base, env: { OTEL_SDK_DISABLED: "TRUE" } })
    const doNotTrack = await createOtlpTelemetryTransport({ ...base, env: { DO_NOT_TRACK: "1" } })
    const productOptOut = await createOtlpTelemetryTransport({ ...base, env: { OMO_TEST_SEND_ANONYMOUS_TELEMETRY: "0" } })

    // then
    expect([otelDisabled, doNotTrack, productOptOut]).toEqual([null, null, null])
    expect(existsSync(dir)).toBe(false)
  })

  test("#given the collector transport #then its sampling capability forces the raw-turn rate to 1", () => {
    // given
    const transport = makeTransport(root())

    // then
    expect(transport.sampling.rawTurnRate).toBe(1)
  })

  test("#given a 200 carrying partial_success #then the batch is settled, never retried, and the rejected count is diagnosed", async () => {
    // given
    const dir = root()
    const partial = toBinary(ExportLogsServiceResponseSchema, create(ExportLogsServiceResponseSchema, {
      partialSuccess: { rejectedLogRecords: 1n, errorMessage: "rejected 1 of 2: #1 unknown_event" },
    }))
    const { calls, fetch } = recordingFetch(() => new Response(partial, { status: 200 }))
    const diagnostics: TelemetryDiagnosticInput[] = []
    const transport = makeTransport(dir, { fetch, diagnostics: (input) => diagnostics.push(input) })

    // when
    capture(transport, "feature_used", { feature: "a" })
    capture(transport, "unknown", { feature: "b" })
    await transport.flush()
    await transport.flush()

    // then
    expect(calls.length).toBe(1)
    expect(spoolNames(dir)).toEqual([])
    expect(diagnostics.map((d) => d.event)).toEqual(["telemetry_otlp_partial_success"])
    expect(transport.droppedEvents()).toBe(0)
  })
})

describe("the first flush after start", () => {
  test("#given an auto-started transport #when an event is captured and flushed before the startup pass ends #then that flush sends the batch", async () => {
    // given
    const dir = root()
    const { calls, fetch } = recordingFetch()
    const transport = await createOtlpTelemetryTransport({
      productEnvPrefix: "OMO_TEST",
      ingestKey: "test-ingest-key",
      spoolDir: dir,
      spoolRoot: dirname(dir),
      resource: testResource(),
      scope: TEST_SCOPE, project: testWireProjection, spans: TEST_SPANS,
      env: {},
      endpoint: "https://collector.test",
      sleep: async () => undefined,
      random: () => 0,
      fetch,
    })
    if (transport === null) throw new Error("transport unexpectedly disabled")

    // when
    capture(transport, "feature_used", { feature: "a" })
    await transport.flush()

    // then
    expect(calls).toHaveLength(1)
    expect(spoolNames(dir).filter((name) => name.startsWith("batch-"))).toEqual([])
    await transport.shutdown()
  })
})

describe("startup and consent failures do not poison the sender", () => {
  test("#given the startup pass rejects #when a later flush runs #then it resolves and sends the batch", async () => {
    // given: a sealed batch left by an earlier process (consent stops its own pump right after the seal)
    const dir = root()
    let consentCalls = 0
    const earlier = makeTransport(dir, { consent: () => ++consentCalls <= 2 })
    capture(earlier, "feature_used", { feature: "a" })
    await earlier.flush()
    expect(spoolNames(dir).filter((name) => name.startsWith("batch-"))).toHaveLength(1)
    // a clock that throws while the next process starts makes its startup claim reject
    let clockDown = true
    const { calls, fetch } = recordingFetch()
    const diagnostics: TelemetryDiagnosticInput[] = []
    const transport = makeTransport(dir, {
      autoStart: true,
      fetch,
      nowMs: () => {
        if (clockDown) throw new Error("clock unavailable")
        return Date.now()
      },
      diagnostics: (input) => diagnostics.push(input),
    })
    await transport.ready
    clockDown = false

    // when
    await transport.flush()

    // then
    expect(diagnostics.some((input) => input.event === "telemetry_otlp_send_failed")).toBe(true)
    expect(calls).toHaveLength(1)
    await transport.shutdown()
  })

  test("#given consent() starts throwing mid-run #when flush and shutdown run #then they resolve, treat it as no consent and purge", async () => {
    // given
    const dir = root()
    let throwing = false
    const diagnostics: TelemetryDiagnosticInput[] = []
    const { calls, fetch } = recordingFetch()
    const transport = makeTransport(dir, {
      fetch,
      consent: () => {
        if (throwing) throw new Error("consent store unreadable")
        return true
      },
      diagnostics: (input) => diagnostics.push(input),
    })
    capture(transport, "feature_used", { feature: "a" })

    // when
    throwing = true
    await transport.flush()
    await transport.shutdown()

    // then
    expect(calls).toHaveLength(0)
    expect(spoolNames(dir).filter((name) => name.endsWith(".otlp"))).toEqual([])
    expect(diagnostics.some((input) => input.event === "telemetry_consent_failed")).toBe(true)
  })
})
