import { afterEach, describe, expect, test } from "bun:test"
import { existsSync } from "node:fs"
import { dirname } from "node:path"

import { create, toBinary } from "@bufbuild/protobuf"

import { createOtlpTelemetryTransport } from "./otlp-sender"
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
  testResource,
} from "./otlp-test-support"
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

  test("#given OTEL_EXPORTER_OTLP_ENDPOINT points elsewhere #then it is ignored; OMO_TELEMETRY_ENDPOINT overrides the configured endpoint", () => {
    // given
    const dir = root()

    // when
    const ignored = makeTransport(dir, { env: { OTEL_EXPORTER_OTLP_ENDPOINT: "http://evil.test", OTEL_EXPORTER_OTLP_LOGS_ENDPOINT: "http://evil.test" } })
    const overridden = makeTransport(dir, { env: { OMO_TELEMETRY_ENDPOINT: "https://staging.test/" } })
    const defaulted = createOtlpTelemetryTransport({ productEnvPrefix: "OMO_TEST", ingestKey: "k", spoolDir: dir, spoolRoot: dirname(dir), resource: testResource(), scope: TEST_SCOPE, env: {}, autoStart: false })

    // then
    expect(ignored.endpoint).toBe("https://collector.test")
    expect(overridden.endpoint).toBe("https://staging.test")
    expect(defaulted?.endpoint).toBe("https://t.omo.dev")
  })

  test("#given OTEL_SDK_DISABLED=true or DO_NOT_TRACK=1 #then no transport is built and no spool directory exists", () => {
    // given
    const dir = root()
    const base = { productEnvPrefix: "OMO_TEST", ingestKey: "k", spoolDir: dir, spoolRoot: dirname(dir), resource: testResource(), scope: TEST_SCOPE, autoStart: false }

    // when
    const otelDisabled = createOtlpTelemetryTransport({ ...base, env: { OTEL_SDK_DISABLED: "TRUE" } })
    const doNotTrack = createOtlpTelemetryTransport({ ...base, env: { DO_NOT_TRACK: "1" } })
    const productOptOut = createOtlpTelemetryTransport({ ...base, env: { OMO_TEST_SEND_ANONYMOUS_TELEMETRY: "0" } })

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
